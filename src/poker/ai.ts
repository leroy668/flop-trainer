/**
 * 电脑玩家的决策逻辑（纯函数）。
 *
 * 拟真人类玩家行为模型：
 * 1. 深度人格系统（TAG紧凶、LAG松凶、平衡策略、跟注站、岩石、疯子）
 * 2. 位置感知（BTN庄家位、CO关煞位、盲注位防守、UTG早位置）
 * 3. 牌力分层与牌面质地感知（超对/顶对强踢脚/中对/听牌/空气，干燥面 vs 湿润面）
 * 4. 战术动作库（翻前进攻方持续下注 C-bet、听牌半诈唬 Semi-bluff、强牌慢打设伏 Trap、
 *    控池 Pot control、抓诈 Bluff-catch、过牌-加注 Check-Raise、偶尔抽风 Spaz）
 * 5. 对手建模（面对疯子放宽跟注、面对岩石收紧）、每手「情绪温度」与尺度漂移
 *
 * 约束不变量：
 * - 所有动作均经由 `legalActions` 过滤，绝对不可能出现非法动作；
 * - 翻牌前严禁全下；
 * - 随机数通过纯函数 Rng 传递，完全可复现。
 */

import type { Card, Scenario, Suit } from './cards';
import { cardKey, createDeck, RANK_VALUES } from './cards';
import { analyzeHeroDraws } from './draws';
import {
  compareHandValue,
  describeHandValue,
  evaluateBestHand,
  HandCategory,
} from './evaluator';
import { summarizeFiveCardHand } from './handType';
import type { Rng } from './rng';
import { nextRandom } from './rng';
import type { Seat, TableAction, TableState } from './table';
import { blindIndices, legalActions } from './table';
import {
  BOT_PERSONAS,
  BOT_STYLES,
  botPersona,
  botProfile,
  botStyle,
  personaStyle,
  type BotPersona,
  type BotStyle,
} from './aiProfile';

export {
  BOT_PERSONAS,
  BOT_STYLES,
  botPersona,
  botProfile,
  botStyle,
  personaStyle,
  type BotPersona,
  type BotStyle,
};

/* ------------------------------------------------------------------ */
/* 强度估计                                                            */
/* ------------------------------------------------------------------ */

/**
 * 起手牌强度（0~1 的启发式估计）。
 *
 * 对子是「基础 0.5 + 点数线性」；非对子由大牌、小牌、同花、连张四项加权。
 * 校准常见组合：AA≈1.00、55≈0.63、AKs≈0.66、KQo≈0.61、76s≈0.47、72o≈0.36。
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

export function toScenario(
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
/* 拟真人类决策辅助分析                                                */
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 格式化底牌中文展示名，例如 "A♠ K♥" 或 "对10" */
function formatHole(hole: readonly [Card, Card]): string {
  const high = RANK_VALUES[hole[0].rank] >= RANK_VALUES[hole[1].rank] ? hole[0] : hole[1];
  const low = high === hole[0] ? hole[1] : hole[0];
  const suited = high.suit === low.suit;
  if (high.rank === low.rank) {
    return `对${high.rank}`;
  }
  return `${high.rank}${low.rank}${suited ? 's' : 'o'}`;
}

/** 识别牌面干燥度（Dry / Wet）与同花面。 */
function analyzeBoardTexture(board: readonly Card[]): {
  isDry: boolean;
  isMonotone: boolean;
  isWet: boolean;
} {
  if (board.length < 3) return { isDry: true, isMonotone: false, isWet: false };
  const suitCounts: Record<Suit, number> = { s: 0, h: 0, d: 0, c: 0 };
  const ranks: number[] = [];
  for (const c of board) {
    suitCounts[c.suit] = (suitCounts[c.suit] ?? 0) + 1;
    ranks.push(RANK_VALUES[c.rank]);
  }
  const maxSuitCount = Math.max(...Object.values(suitCounts));
  const isMonotone = maxSuitCount >= 3;
  ranks.sort((a, b) => a - b);
  let closeGaps = 0;
  for (let i = 1; i < ranks.length; i += 1) {
    if (ranks[i] - ranks[i - 1] <= 2) closeGaps += 1;
  }
  const isConnected = closeGaps >= 2;
  const isDry = !isMonotone && !isConnected && maxSuitCount <= 2;
  return { isDry, isMonotone, isWet: isMonotone || isConnected };
}

/** 获取玩家当前的位置标签 */
function positionTag(seatIndex: number, button: number, seatCount: number): string {
  const { smallBlind, bigBlind } = blindIndices(seatCount, button);
  if (seatIndex === button) return '庄家位(BTN)';
  if (seatIndex === smallBlind) return '小盲位(SB)';
  if (seatIndex === bigBlind) return '大盲位(BB)';
  const step = (seatIndex - button + seatCount) % seatCount;
  if (step === 1 || (seatCount >= 4 && step === 3)) return '前位(UTG)';
  if (step === seatCount - 1) return '关煞位(CO)';
  return '中位(MP)';
}

/** 是否拥有翻后位置（庄家位或关煞位）。 */
function hasPostflopPosition(seatIndex: number, button: number, seatCount: number): boolean {
  if (seatIndex === button) return true;
  const step = (seatIndex - button + seatCount) % seatCount;
  return step === seatCount - 1 && seatCount >= 4;
}

/* ------------------------------------------------------------------ */
/* 拟真电脑决策主入口                                                  */
/* ------------------------------------------------------------------ */

/**
 * 从当前可用的「下注 / 加注」按钮里，按人格尺度偏好挑一个档位（5 / 10 / 20）。
 *
 * `sizing`（0~1，人格固有偏好）+ `boost`（本手战术倾向）+ 每次决策的情绪漂移，
 * 一起决定最终落在小注还是顶格大注，避免所有机器人永远只打同一个数字。
 */
function chooseBetSize(
  bets: readonly TableAction[],
  sizing: number,
  rng: Rng,
  boost = 0,
): number | null {
  const sizes = bets
    .map((action) => action.amount ?? 0)
    .filter((amount) => amount > 0)
    .sort((a, b) => a - b);
  if (sizes.length === 0) return null;
  const drift = (nextRandom(rng) - 0.5) * 0.55;
  const t = clamp(sizing + boost + drift, 0, 0.999);
  const index = Math.min(sizes.length - 1, Math.floor(t * sizes.length));
  return sizes[index];
}

/**
 * 拟真电脑玩家决策函数。
 *
 * 完整的人性化博弈思维树：起手牌位置策略、翻前反加注、翻牌后持续下注、
 * 听牌半诈唬、强牌设伏慢打、过牌-加注、底池赔率折算、对手建模，
 * 以及每个人格各具特色、且每手都带情绪漂移的尺度选择。
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

  const persona: BotPersona = botPersona(seatIndex, state.rngSeed);
  // 两个随机数：roll 决定「做什么」，mood 是这一手的情绪温度（打散固定阈值）。
  const roll = nextRandom(rng);
  const mood = nextRandom(rng);

  const toCall = Math.max(0, state.currentBet - seat.committedStreet);
  const opponents = state.seats.filter(
    (candidate: Seat) => !candidate.folded && candidate.index !== seatIndex,
  ).length;
  const estimate = estimateEquity(seat.hole, state.board, opponents);

  const call = pick(legal, 'call');
  const check = pick(legal, 'check');
  const allin = pick(legal, 'allin');
  const bets = legal.filter((action) => action.type === 'bet');

  /** 在当前合法的加注档位里挑一个尺度；返回 null 表示当前根本不能加注。 */
  const raiseTo = (boost = 0): TableAction | null => {
    const size = chooseBetSize(bets, persona.sizing, rng, boost);
    if (size === null) return null;
    return pick(legal, 'bet', size) ?? bets[bets.length - 1] ?? null;
  };

  // 情绪温度：让同样牌力、同样局面的决策，在不同手/不同时刻略有摇摆。
  const temp = (mood - 0.5) * 2; // -1 ~ 1
  const aggression = clamp(persona.aggression + temp * 0.12, 0.02, 0.95);
  const patience = clamp(persona.callDown + temp * 0.1, 0.02, 0.98);

  const fold: TableAction = { type: 'fold' };

  const makeDecision = (chosen: TableAction | null, noteText: string): TableAction => {
    if (chosen) return { ...chosen, note: noteText };
    if (check) return { ...check, note: noteText };
    if (call) return { ...call, note: noteText };
    return { ...fold, note: noteText };
  };

  const holeLabel = formatHole(seat.hole);
  const posLabel = positionTag(seatIndex, state.button, state.seats.length);
  const inPosition = hasPostflopPosition(seatIndex, state.button, state.seats.length);

  /* ---------------------------------------------------------------- */
  /* 对手建模：上一个下注 / 加注的人是什么性格？                        */
  /* ---------------------------------------------------------------- */
  const lastAggrPersona =
    state.lastAggressor !== null && state.lastAggressor !== seatIndex
      ? botPersona(state.lastAggressor, state.rngSeed)
      : null;
  const facingManiac = lastAggrPersona
    ? lastAggrPersona.bluff >= 0.14 || lastAggrPersona.aggression >= 0.6
    : false;
  const facingRock = lastAggrPersona
    ? lastAggrPersona.bluff <= 0.02 && lastAggrPersona.aggression <= 0.3
    : false;
  // 对手建模对「愿意跟注」的修正：疯子多加，岩石少加。
  const readAdjust = (facingManiac ? 0.18 : 0) - (facingRock ? 0.16 : 0);

  /* ================================================================ */
  /* 1. 翻牌前决策 (Preflop)                                          */
  /* ================================================================ */
  if (state.street === 'preflop') {
    const rawScore = estimate.made;
    const isButton = seatIndex === state.button;
    const { bigBlind, smallBlind } = blindIndices(state.seats.length, state.button);
    const isBB = seatIndex === bigBlind;
    const isSB = seatIndex === smallBlind;

    let posBonus = 0;
    if (isButton) posBonus = 0.05;
    else if (isBB) posBonus = 0.04; // 大盲已投 10，防守赔率优厚
    else if (isSB) posBonus = -0.03; // 小盲翻后无位置

    const effectiveScore =
      rawScore + posBonus - persona.tightness * 0.35 + temp * 0.03;
    const isPremium = rawScore >= 0.72; // AA, KK, QQ, AKs, AKo
    const isStrong = rawScore >= 0.58; // JJ-88, AQs, AJs, KQs
    const isPlayable = rawScore >= 0.44; // 中低对, 同花连张, 大高张

    // 局面 A：无人下注 / 大盲有免费看牌机会
    if (toCall === 0) {
      if (bets.length > 0 && isPremium && roll < 0.12 + aggression * 0.35) {
        const raiseAct = raiseTo(0.1);
        if (raiseAct) {
          return makeDecision(
            raiseAct,
            `在大盲位手握极品【${holeLabel}】，加注到 ${raiseAct.amount} 试探`,
          );
        }
      }
      return makeDecision(
        check ?? call,
        `在大盲位手握【${holeLabel}】，免费过牌看翻牌`,
      );
    }

    // 局面 B：只有盲注 / 平跟（还没人加注），轮到我们开池
    if (state.currentBet <= 10) {
      // 好牌偶尔主动加注开池，而不是永远平跟
      const openChance = 0.10 + aggression * 0.4 + persona.threeBet * 0.25;
      if (bets.length > 0 && (isPremium || isStrong) && roll < openChance) {
        const openAct = raiseTo(isPremium ? 0.5 : 0.15);
        if (openAct) {
          return makeDecision(
            openAct,
            `手握好牌【${holeLabel}】，主动加注到 ${openAct.amount}`,
          );
        }
      }

      // 平跟进池：门槛随牌力、人格松紧与跟注站程度浮动
      const limpThreshold =
        0.42 - patience * 0.08 - aggression * 0.06 + persona.tightness * 0.3;
      if (isPlayable || effectiveScore >= limpThreshold) {
        return makeDecision(
          call ?? check,
          `在${posLabel}手握【${holeLabel}】，平跟 ${toCall || 0} 看翻牌${inPosition ? '（有位置）' : ''}`,
        );
      }
      return makeDecision(fold, `起手牌【${holeLabel}】太差，弃牌`);
    }

    // 局面 C：面对别人的加注
    const threeBetChance =
      persona.threeBet * (isPremium ? 1.4 : isStrong ? 0.8 : 0.2) + (inPosition ? 0.05 : 0);
    if (bets.length > 0 && (isPremium || isStrong) && roll < threeBetChance) {
      const reraise = raiseTo(0.55);
      if (reraise) {
        return makeDecision(
          reraise,
          `手握【${holeLabel}】，反加注到 ${reraise.amount}`,
        );
      }
    }
    if (isPremium || isStrong) {
      return makeDecision(call, `手握【${holeLabel}】，跟注看翻牌`);
    }
    if (isPlayable && roll < 0.3 + patience * 0.4) {
      return makeDecision(call, `【${holeLabel}】还能打，跟注看翻牌`);
    }
    if (roll < patience * 0.22) {
      return makeDecision(call, `【${holeLabel}】凑个热闹，跟注`);
    }
    return makeDecision(fold, `面对加注，手牌【${holeLabel}】不够强，弃牌`);
  }

  /* ================================================================ */
  /* 2. 翻牌后决策 (Postflop: Flop, Turn, River)                      */
  /* ================================================================ */
  const scenario = toScenario(seat.hole, state.board);
  const heroBest = evaluateBestHand([...state.board, ...seat.hole]);
  const handSummary = scenario ? summarizeFiveCardHand(scenario) : null;
  const board = analyzeBoardTexture(state.board);

  const handCategory = heroBest.category;
  const handDesc = handSummary ? handSummary.summary : describeHandValue(heroBest);

  // 牌力层级判定
  const isNuts =
    handCategory >= HandCategory.FullHouse ||
    (handCategory >= HandCategory.Flush && estimate.made >= 0.94);
  const isMonster =
    isNuts ||
    handCategory === HandCategory.Straight ||
    handCategory === HandCategory.Trips ||
    (handSummary?.pairPosition === 'overpair' && estimate.made >= 0.88);
  const isStrong =
    isMonster ||
    handCategory === HandCategory.TwoPair ||
    handSummary?.pairPosition === 'overpair' ||
    (handSummary?.pairPosition === 'top-pair' && estimate.made >= 0.68);
  const isMedium =
    !isStrong &&
    (handSummary?.pairPosition === 'top-pair' ||
      handSummary?.pairPosition === 'middle-pair' ||
      estimate.made >= 0.5);
  const isWeak =
    !isMedium &&
    !isStrong &&
    (handCategory === HandCategory.OnePair || estimate.made >= 0.3);

  // 听牌判定（同花/顺子/组合听牌）
  const hasStrongDraw =
    state.street !== 'river' &&
    ((handSummary?.comboDraw ?? false) ||
      (handSummary?.draws.some((d) => !d.backdoor && d.outs >= 8) ?? false) ||
      estimate.draw >= 0.25);
  const hasWeakDraw =
    state.street !== 'river' &&
    !hasStrongDraw &&
    ((handSummary?.draws.some((d) => !d.backdoor && d.outs >= 4) ?? false) ||
      estimate.draw >= 0.12);

  // 是否为翻前进攻方（享有持续下注 C-Bet 权利）
  const isPreflopAggressor = state.preflopAggressor === seatIndex;
  // 干燥面更适合诈唬，湿润/同花面收着点。
  const bluffSurface = board.isDry ? 1.25 : board.isWet ? 0.7 : 1;

  /* ---------------------------------------------------------------- */
  /* 翻后分支 0：极罕见的情绪抽风（Spaz）——人类的不确定性             */
  /* ---------------------------------------------------------------- */
  if (mood < persona.spaz * 2.5) {
    if (bets.length > 0 && roll < 0.6) {
      const spazBet = raiseTo(0.65);
      if (spazBet) {
        return makeDecision(spazBet, `手滑拍了一枪 ${spazBet.amount}，纯属心情`);
      }
    }
    if (call && toCall > 0 && roll >= 0.6) {
      return makeDecision(call, `今天心情好，跟一注看看`);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 翻后分支 1：当前无人下注 (toCall === 0)                           */
  /* ---------------------------------------------------------------- */
  if (toCall === 0) {
    if (bets.length === 0) return makeDecision(check, `过牌看牌`);

    // 1.1 坚果 / 超级大牌
    if (isNuts || (isMonster && estimate.equity >= 0.85)) {
      // 朋友局里几乎不推全下，只在河牌、底池已经很大或筹码见底时极小概率来一手
      if (
        state.street === 'river' &&
        (state.pot >= 80 || seat.stack <= 30) &&
        allin &&
        roll < 0.12
      ) {
        return makeDecision(allin, `手握坚果【${handDesc}】，筹码见底顺势全下`);
      }
      // 慢打设伏：人格越爱设伏，越倾向过牌
      if (roll < persona.trap) {
        return makeDecision(check, `拿到大牌【${handDesc}】，过牌设伏等后街`);
      }
      const valueBet = raiseTo(0.3);
      if (valueBet) {
        return makeDecision(
          valueBet,
          `手握大牌【${handDesc}】，下注 ${valueBet.amount} 收价值`,
        );
      }
      return makeDecision(check, `手握大牌【${handDesc}】，过牌`);
    }

    // 1.2 强牌（两对、超对、顶对好踢脚）
    if (isStrong) {
      const cbetChance = isPreflopAggressor
        ? persona.cbet * 0.9 + aggression * 0.25
        : 0.3 + aggression * 0.3;
      if (roll < cbetChance) {
        const strongBet = raiseTo(isPreflopAggressor ? 0.05 : 0);
        if (strongBet) {
          return makeDecision(
            strongBet,
            isPreflopAggressor
              ? `延续翻前气势，下注 ${strongBet.amount}`
              : `手握【${handDesc}】，下注 ${strongBet.amount}`,
          );
        }
      }
      return makeDecision(check, `手握【${handDesc}】，过牌控池`);
    }

    // 1.3 听牌（同花/顺子）——半诈唬
    if (hasStrongDraw) {
      const semiChance = persona.semiBluff * bluffSurface * (inPosition ? 1.15 : 0.9);
      if (roll < semiChance) {
        const drawBet = raiseTo(0.1);
        if (drawBet) {
          return makeDecision(
            drawBet,
            `手握听牌【${handDesc}】，半诈唬下注 ${drawBet.amount}`,
          );
        }
      }
      return makeDecision(check, `手握听牌【${handDesc}】，过牌看下一张`);
    }
    if (hasWeakDraw && roll < persona.semiBluff * 0.35 * bluffSurface) {
      const probeBet = raiseTo(-0.05);
      if (probeBet) {
        return makeDecision(probeBet, `小听牌，便宜下注 ${probeBet.amount} 探路`);
      }
    }

    // 1.4 中等牌（中对、弱顶对）——偶尔小额价值下注，多数控池
    if (isMedium) {
      if (roll < 0.12 + aggression * 0.18) {
        const thinBet = raiseTo(-0.15);
        if (thinBet) {
          return makeDecision(thinBet, `手握【${handDesc}】，小额领先下注 ${thinBet.amount}`);
        }
      }
      return makeDecision(check, `手握【${handDesc}】，过牌控池`);
    }

    // 1.5 空气牌——纯诈唬（只有一部分人格会做）
    const bluffChance = persona.bluff * bluffSurface * (inPosition ? 1.3 : 0.85);
    if (roll < bluffChance) {
      const bluffBet = raiseTo(isPreflopAggressor ? 0.05 : -0.05);
      if (bluffBet) {
        return makeDecision(
          bluffBet,
          isPreflopAggressor
            ? `翻前是我加注的，翻牌继续代表强牌下注 ${bluffBet.amount}`
            : `牌面没中，下注 ${bluffBet.amount} 施压`,
        );
      }
    }
    return makeDecision(check, `没中牌，轻松过牌`);
  }

  /* ---------------------------------------------------------------- */
  /* 翻后分支 2：面临对手下注 / 加注 (toCall > 0)                      */
  /* ---------------------------------------------------------------- */
  const potOdds = toCall / (state.pot + toCall);

  // 2.1 坚果 / 怪物级大牌
  if (isNuts || (isMonster && estimate.equity >= 0.85)) {
    if (
      state.street === 'river' &&
      (state.pot >= 80 || seat.stack <= 30) &&
      allin &&
      roll < 0.15
    ) {
      return makeDecision(allin, `手握大牌【${handDesc}】，筹码见底全下`);
    }
    // 过牌-加注 / 反加注：人格越爱做越容易反打
    if (bets.length > 0 && roll < persona.checkRaise) {
      const checkRaise = raiseTo(0.5);
      if (checkRaise) {
        return makeDecision(
          checkRaise,
          `手握【${handDesc}】，反加注到 ${checkRaise.amount}`,
        );
      }
    }
    // 慢打设伏
    if (roll < persona.trap) {
      return makeDecision(call ?? check, `手握【${handDesc}】，平跟设伏`);
    }
    if (bets.length > 0 && roll < 0.4) {
      const valueRaise = raiseTo(0.3);
      if (valueRaise) {
        return makeDecision(
          valueRaise,
          `手握【${handDesc}】，加注到 ${valueRaise.amount} 做大底池`,
        );
      }
    }
    return makeDecision(call ?? check, `手握大牌【${handDesc}】，跟注看后牌`);
  }

  // 2.2 强牌（两对、超对、顶对好踢脚）
  if (isStrong) {
    if (bets.length > 0 && roll < persona.checkRaise * 0.85) {
      const strongRaise = raiseTo(0.15);
      if (strongRaise) {
        return makeDecision(
          strongRaise,
          `手握【${handDesc}】，加注到 ${strongRaise.amount}`,
        );
      }
    }
    // 只有大幅落后时才考虑弃牌（例如面对岩石的大注）
    if (facingRock && toCall >= 20 && estimate.made < 0.62 && roll < 0.35) {
      return makeDecision(fold, `老实人下了大注，我这手【${handDesc}】先撤`);
    }
    return makeDecision(call ?? check, `手握【${handDesc}】，跟注`);
  }

  // 2.3 听牌（同花/顺子）面对下注
  if (hasStrongDraw) {
    // 半诈唬加注（用听牌施压），按人格频率触发
    if (bets.length > 0 && roll < persona.semiBluff * 0.45 && estimate.draw >= 0.28) {
      const semiRaise = raiseTo(0.2);
      if (semiRaise) {
        return makeDecision(
          semiRaise,
          `听牌【${handDesc}】，半诈唬加注到 ${semiRaise.amount}`,
        );
      }
    }
    // 赔率合适或便宜就看下一张
    if (call && (toCall <= 10 || estimate.draw > potOdds + 0.06)) {
      return makeDecision(
        call,
        `手握听牌【${handDesc}】，跟注看下一张能不能中`,
      );
    }
    if (call && roll < 0.3) {
      return makeDecision(call, `追一手，跟注看看`);
    }
    return makeDecision(fold, `听牌代价太高，弃牌`);
  }

  // 2.4 中等牌（中对、弱顶对）——抓诈 / 控池
  if (isMedium) {
    const effectivePatience = clamp(patience + readAdjust + persona.trap * 0.1, 0.05, 0.95);
    const cheapFactor = toCall <= 5 ? 1 : toCall <= 10 ? 0.7 : 0.3;
    if (call && roll < effectivePatience * cheapFactor) {
      return makeDecision(call, `手握【${handDesc}】，跟注看看${facingManiac ? '（对手爱诈唬）' : ''}`);
    }
    return makeDecision(fold, `面对下注，中等牌收手弃牌`);
  }

  // 2.5 弱牌 / 边缘牌
  if (isWeak) {
    const effectivePatience = clamp(patience + readAdjust, 0.05, 0.95);
    if (call && toCall <= 5 && roll < 0.12 + effectivePatience * 0.3) {
      return makeDecision(call, `就 ${toCall} 筹码，跟一注看戏`);
    }
  }

  // 2.6 纯空气牌——偶尔诈唬加注，多数弃牌
  if (bets.length > 0 && roll < persona.bluff * bluffSurface * 0.6) {
    const bluffRaise = raiseTo(0.35);
    if (bluffRaise) {
      return makeDecision(bluffRaise, `空气牌诈唬，加注到 ${bluffRaise.amount}`);
    }
  }
  return makeDecision(fold, `没牌弃掉`);
}
