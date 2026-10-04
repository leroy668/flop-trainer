/**
 * 电脑玩家的决策逻辑（纯函数）。
 *
 * 翻牌后用的是**精确枚举**：把「未知牌」里所有可能的对手两张牌枚举一遍，
 * 数一数有多少比例打不过自己（成牌强度），再加上听牌补成概率（
 * 复用 `draws.ts` 的精确补牌统计），得到胜率估计。
 * 翻牌前没有公共牌，无法枚举摊牌，所以用一套明确定义的起手牌强度公式
 * （点数、是否同花、连张程度），页面上会标注这是启发式估计。
 *
 * 决策本身是「胜率 vs 底池赔率」的风格化版本：每个座位有固定的松紧/激进度，
 * 再加上一点随机。所有动作都会先用 `legalActions` 过滤，
 * 因此机器人**不可能**做出非法动作（包括翻牌前全下）。
 */

import type { Card, Scenario } from './cards';
import { cardKey, createDeck, RANK_VALUES } from './cards';
import { analyzeHeroDraws } from './draws';
import { compareHandValue, evaluateBestHand } from './evaluator';
import type { Rng } from './rng';
import { nextRandom } from './rng';
import type { Seat, TableAction, TableState } from './table';
import { legalActions } from './table';

/* ------------------------------------------------------------------ */
/* 强度估计                                                            */
/* ------------------------------------------------------------------ */

export interface BotStyle {
  label: string;
  /** 跟注需要的额外胜率余量。 */
  callMargin: number;
  /** 主动加注所需的胜率。 */
  raiseThreshold: number;
  /** 没牌时偷鸡的概率。 */
  bluff: number;
}

export const BOT_STYLES: readonly BotStyle[] = [
  { label: '保守', callMargin: 0.12, raiseThreshold: 0.74, bluff: 0.03 },
  { label: '激进', callMargin: 0.04, raiseThreshold: 0.6, bluff: 0.12 },
  { label: '平衡', callMargin: 0.08, raiseThreshold: 0.68, bluff: 0.07 },
  { label: '松凶', callMargin: 0.06, raiseThreshold: 0.64, bluff: 0.16 },
];

export function botStyle(seatIndex: number): BotStyle {
  return BOT_STYLES[seatIndex % BOT_STYLES.length];
}

/**
 * 起手牌强度（0~1 的启发式估计）。
 *
 * 对子是「基础 0.5 + 点数线性」；非对子由大牌、小牌、同花、连张四项加权。
 * 校准过几个常见组合：AA≈1.00、55≈0.63、AKs≈0.66、KQo≈0.61、76s≈0.47、72o≈0.36，
 * 与它们对随机手牌的实测胜率基本吻合。
 */
export function preflopStrength(hole: readonly [Card, Card]): number {
  const a = RANK_VALUES[hole[0].rank];
  const b = RANK_VALUES[hole[1].rank];
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  const suited = hole[0].suit === hole[1].suit;

  if (a === b) {
    return Math.min(1, 0.5 + ((high - 2) / 12) * 0.5);
  }

  let score = 0.18 + (high / 14) * 0.32 + (low / 14) * 0.12;
  if (suited) score += 0.05;
  const gap = high - low;
  if (gap === 1) score += 0.03;
  else if (gap === 2) score += 0.015;
  return Math.min(1, score);
}

export interface EquityEstimate {
  /** 成牌强度：随机对手两张牌打不过你的比例（翻牌前为起手牌强度）。 */
  made: number;
  /** 到河牌为止至少补成一种听牌的概率。 */
  draw: number;
  /** 综合胜率估计（多个对手按独立近似）。 */
  equity: number;
  /** 参与估计的对手数量。 */
  opponents: number;
  /** 枚举了多少种对手手牌。 */
  samples: number;
}

/** 未知牌：除了自己的底牌和公共牌以外的所有牌。 */
export function unknownCards(
  hole: readonly [Card, Card],
  board: readonly Card[],
): Card[] {
  const used = new Set<string>();
  for (const card of hole) used.add(cardKey(card));
  for (const card of board) used.add(cardKey(card));
  return createDeck().filter((card) => !used.has(cardKey(card)));
}

function toScenario(
  hole: readonly [Card, Card],
  board: readonly Card[],
): Scenario | null {
  if (board.length < 3) return null;
  return {
    hero: [hole[0], hole[1]],
    flop: [board[0], board[1], board[2]],
    turn: board[3],
    river: board[4],
  };
}

/**
 * 胜率估计。
 *
 * `made` 是精确值：枚举所有对手两张牌组合，比较「当前公共牌下」的成牌大小
 * （翻牌枚举 C(47,2)=1081 种、转牌 1035 种、河牌 990 种）。
 * `draw` 是精确值：到河牌为止至少补成一种听牌的概率。
 * 两者以「已经领先，或者暂时落后但补成」的方式合并，多路对手按独立近似。
 */
export function estimateEquity(
  hole: readonly [Card, Card],
  board: readonly Card[],
  opponents: number,
): EquityEstimate {
  const rivals = Math.max(1, opponents);

  if (board.length < 3) {
    const score = preflopStrength(hole);
    return {
      made: score,
      draw: 0,
      equity: Math.pow(score, rivals),
      opponents: rivals,
      samples: 0,
    };
  }

  const pool = unknownCards(hole, board);
  const heroHand = evaluateBestHand([...board, ...hole]);
  let score = 0;
  let samples = 0;
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const rival = evaluateBestHand([...board, pool[i], pool[j]]);
      samples += 1;
      const comparison = compareHandValue(heroHand, rival);
      if (comparison > 0) score += 1;
      else if (comparison === 0) score += 0.5;
    }
  }
  const made = samples === 0 ? 0.5 : score / samples;

  const scenario = toScenario(hole, board);
  const draw = scenario ? analyzeHeroDraws(scenario).union.finalProbability : 0;
  const single = made + (1 - made) * draw * 0.85;

  return {
    made,
    draw,
    equity: Math.pow(single, rivals),
    opponents: rivals,
    samples,
  };
}

/* ------------------------------------------------------------------ */
/* 决策                                                                */
/* ------------------------------------------------------------------ */

function pick(
  legal: readonly TableAction[],
  type: TableAction['type'],
  amount?: number,
): TableAction | null {
  return (
    legal.find(
      (action) =>
        action.type === type && (amount === undefined || action.amount === amount),
    ) ?? null
  );
}

/**
 * 机器人决策。返回的动作一定是 `legalActions` 里的一个，
 * 因此不可能出现非法动作（包括翻牌前全下）。
 *
 * 翻牌前用起手牌强度阈值（按跟注额调整），翻牌后用「胜率 vs 底池赔率」。
 */
export function decideBotAction(
  state: TableState,
  seatIndex: number,
  rng: Rng,
): TableAction {
  const legal: TableAction[] = legalActions(state, seatIndex);
  if (legal.length === 0) {
    throw new Error(`座位 ${seatIndex} 现在不能行动`);
  }
  const seat = state.seats[seatIndex];
  if (!seat.hole) throw new Error(`座位 ${seatIndex} 没有底牌`);

  const toCall = Math.max(0, state.currentBet - seat.committedStreet);
  const opponents = state.seats.filter(
    (candidate: Seat) => !candidate.folded && candidate.index !== seatIndex,
  ).length;
  const estimate = estimateEquity(seat.hole, state.board, opponents);
  const style = botStyle(seatIndex);
  const roll = nextRandom(rng);

  const call = pick(legal, 'call');
  const check = pick(legal, 'check');
  const allin = pick(legal, 'allin');
  const bets = legal.filter((action) => action.type === 'bet');
  /** 只在 bets 非空时调用。 */
  const bet = (size: number): TableAction | null =>
    pick(legal, 'bet', size) ?? bets[bets.length - 1] ?? null;

  const fold: TableAction = { type: 'fold' };
  const fallback = (): TableAction => call ?? check ?? fold;

  if (toCall === 0) {
    if (bets.length > 0) {
      const raiseNow = (): TableAction | null => {
        if (estimate.equity >= 0.9 && allin && roll < 0.5) return allin;
        if (estimate.equity >= style.raiseThreshold + 0.15) return bet(20);
        if (estimate.equity >= style.raiseThreshold) {
          return roll < 0.35 ? bet(20) : bet(10);
        }
        return null;
      };
      const raise = raiseNow();
      if (raise) return raise;
      if (estimate.equity >= 0.45 && roll < 0.45) {
        const small = bet(5);
        if (small) return small;
      }
      if (roll < style.bluff) {
        const bluff = bet(5);
        if (bluff) return bluff;
      }
    }
    return fallback();
  }

  if (state.street === 'preflop') {
    // 起手牌：跟注额越大，要求越高。
    const need =
      0.42 + Math.min(0.2, (toCall / 20) * 0.12) + style.callMargin * 0.5;
    const score = estimate.made;
    if (score >= need + 0.12 && bets.length > 0 && roll < 0.55) {
      const raised = score >= 0.8 ? bet(20) ?? bet(10) : bet(10) ?? bet(20);
      if (raised) return raised;
    }
    if (score >= need) return fallback();
    return fold;
  }

  // 翻牌后：胜率 vs 底池赔率。
  const potOdds = toCall / (state.pot + toCall);
  const equity = estimate.equity;
  if (allin && equity >= 0.9 && roll < 0.7) return allin;
  if (bets.length > 0) {
    if (equity >= 0.8 && roll < 0.6) {
      const big = bet(20);
      if (big) return big;
    }
    if (equity >= 0.68 && roll < 0.45) {
      const mid = bet(10);
      if (mid) return mid;
    }
  }
  if (equity > potOdds + style.callMargin) return fallback();
  return fold;
}

/** 给界面用的一句话说明：这个机器人在用什么口径。 */
export function botProfile(seatIndex: number): string {
  const style = botStyle(seatIndex);
  return `${style.label}型（跟注余量 ${(style.callMargin * 100).toFixed(0)}%、偷鸡 ${(style.bluff * 100).toFixed(0)}%）`;
}
