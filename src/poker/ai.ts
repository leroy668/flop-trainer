/**
 * 电脑玩家的决策逻辑（纯函数）。
 *
 * 拟真人类玩家行为模型：
 * 1. 深度人格系统（TAG紧凶、LAG松凶、平衡策略、跟注站、岩石、疯子）
 * 2. 位置感知（BTN庄家位、CO关煞位、盲注位防守、UTG早位置）
 * 3. 牌力分层与牌面质地感知（超对/顶对强踢脚/中对/听牌/空气，干燥面 vs 湿润面）
 * 4. 战术动作库（翻前进攻方持续下注 C-bet、听牌半诈唬 Semi-bluff、强牌慢打设伏 Trap、控池 Pot control、抓诈 Bluff-catch）
 * 5. 真实内心独白（为每个动作生成细腻、符合扑克术语与玩家人设的思路一句话）
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
  HAND_CATEGORY_LABELS,
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

/** 识别牌面干燥度（Dry / Wet） */
function analyzeBoardTexture(board: readonly Card[]): { isDry: boolean; isMonotone: boolean } {
  if (board.length < 3) return { isDry: true, isMonotone: false };
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
  return { isDry, isMonotone };
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

/* ------------------------------------------------------------------ */
/* 拟真电脑决策主入口                                                  */
/* ------------------------------------------------------------------ */

/**
 * 拟真电脑玩家决策函数。
 * 包含完整的人性化博弈思维树：起手牌位置策略、翻牌后持续下注、
 * 听牌半诈唬、强牌设伏慢打、底池赔率折算以及各具特色的人格反应。
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
  const style = personaStyle(persona);
  const roll = nextRandom(rng);

  const toCall = Math.max(0, state.currentBet - seat.committedStreet);
  const opponents = state.seats.filter(
    (candidate: Seat) => !candidate.folded && candidate.index !== seatIndex,
  ).length;
  const estimate = estimateEquity(seat.hole, state.board, opponents);

  const call = pick(legal, 'call');
  const check = pick(legal, 'check');
  const allin = pick(legal, 'allin');
  const bets = legal.filter((action) => action.type === 'bet');

  const bet = (targetSize: number): TableAction | null => {
    if (bets.length === 0) return null;
    return (
      pick(legal, 'bet', targetSize) ??
      bets.find((b) => (b.amount ?? 0) >= targetSize) ??
      bets[bets.length - 1] ??
      null
    );
  };

  const fold: TableAction = { type: 'fold' };

  // 安全兜底，同时附加默认说明
  const makeDecision = (chosen: TableAction | null, noteText: string): TableAction => {
    if (chosen) {
      return { ...chosen, note: noteText };
    }
    if (check) return { ...check, note: noteText };
    if (call) return { ...call, note: noteText };
    return { ...fold, note: noteText };
  };

  const holeLabel = formatHole(seat.hole);
  const posLabel = positionTag(seatIndex, state.button, state.seats.length);
  const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;

  // 上一个行动者的性格画像分析（若存在）
  const lastAggrPersona =
    state.lastAggressor !== null && state.lastAggressor !== seatIndex
      ? botPersona(state.lastAggressor, state.rngSeed)
      : null;

  /* ================================================================ */
  /* 1. 翻牌前决策 (Preflop)                                          */
  /* ================================================================ */
  if (state.street === 'preflop') {
    const rawScore = estimate.made;
    const isButton = seatIndex === state.button;
    const { bigBlind, smallBlind } = blindIndices(state.seats.length, state.button);
    const isBB = seatIndex === bigBlind;
    const isSB = seatIndex === smallBlind;

    // 位置修正与起手牌特征
    let posBonus = 0;
    if (isButton) posBonus = 0.05;
    else if (isBB) posBonus = 0.04; // 大盲由于已有10投入，防守赔率优厚
    else if (isSB) posBonus = -0.03; // 小盲翻后无位置

    const effectiveScore = rawScore + posBonus - persona.tightness * 0.35;
    const isPremium = rawScore >= 0.72; // AA, KK, QQ, AKs, AKo
    const isStrong = rawScore >= 0.58;  // JJ-88, AQs, AJs, KQs
    const isPlayable = rawScore >= 0.44; // 中低对, 同花连张, 大高张

    // 局面 A: 无人下注 / 大盲有过牌免费看牌机会 (toCall === 0)
    if (toCall === 0) {
      if (bets.length > 0) {
        // 大盲位拿到强牌惩罚溜入者，或者松凶/疯子偷盲加注
        if (
          isPremium ||
          (isStrong && roll < persona.aggression * 0.7) ||
          roll < persona.bluff * 0.6
        ) {
          const raiseAct = bet(20) ?? bet(10);
          if (raiseAct) {
            return makeDecision(
              raiseAct,
              isPremium
                ? `在${posLabel}拿到极品手牌【${holeLabel}】，加注惩罚溜入者做大底池`
                : `在${posLabel}利用主动权加注到 20 施压`,
            );
          }
        }
      }
      return makeDecision(
        check ?? call,
        `在大盲位手握【${holeLabel}】，有过牌免费看翻牌的机会，过牌控池`,
      );
    }

    // 局面 B: 面对底池只有大盲平跟 (toCall === 5 或 10，尚未有人加注到 20)
    if (state.currentBet <= 10) {
      if (bets.length > 0) {
        // 优质牌主动 Open-Raise
        const openThreshold = 0.54 + persona.tightness * 0.2;
        if (effectiveScore >= openThreshold) {
          if (roll < persona.aggression + (isButton ? 0.2 : 0)) {
            const openAct = bet(20) ?? bet(10);
            if (openAct) {
              return makeDecision(
                openAct,
                `在${posLabel}拿到优势手牌【${holeLabel}】，加注到 20 抢占主动权`,
              );
            }
          }
        }
        // 松凶/疯子在有利位置尝试偷盲
        if ((isButton || posLabel.includes('CO')) && roll < persona.bluff) {
          const stealAct = bet(20);
          if (stealAct) {
            return makeDecision(stealAct, `在${posLabel}看准时机加注 20 偷盲试探`);
          }
        }
      }

      // 跟注进池看翻牌 (Limp / Complete)
      if (isPlayable || persona.callDown >= 0.6 || effectiveScore >= 0.42) {
        return makeDecision(
          call ?? check,
          `在${posLabel}手握【${holeLabel}】，花 ${toCall} 筹码便宜看翻牌`,
        );
      }

      return makeDecision(
        fold,
        `起手牌【${holeLabel}】在${posLabel}不够看，理智弃牌保持筹码`,
      );
    }

    // 局面 C: 面临别人加注到 20 (toCall >= 10，顶格压力)
    if (isPremium) {
      // 极品牌面对加注：跟注设伏或反加注（翻前顶格20已达上限，跟注即可）
      return makeDecision(
        call,
        `手握顶级起手牌【${holeLabel}】，面对加注稳稳跟注设伏`,
      );
    }

    // 大盲位防守 (BB Defend)
    if (isBB && toCall <= 10 && (isStrong || isPlayable || roll < persona.callDown)) {
      return makeDecision(
        call,
        `大盲位已有投入，底池赔率划算，手握【${holeLabel}】防守大盲`,
      );
    }

    // 强投机牌看潜在赔率（对子中暗三条、同花连张等）
    if (
      (isStrong || (isPlayable && opponents >= 2)) &&
      effectiveScore >= 0.46 - persona.callDown * 0.12
    ) {
      return makeDecision(
        call,
        `手握【${holeLabel}】，看好潜在翻牌赔率，跟注看翻牌`,
      );
    }

    // 疯子或偶尔上头 spaz 搞事
    if (roll < persona.spaz * 0.4 && call) {
      return makeDecision(call, `风格奔放：用【${holeLabel}】跟注博一把`);
    }

    return makeDecision(
      fold,
      `面对加注，手牌【${holeLabel}】难以支撑，果断弃牌止损`,
    );
  }

  /* ================================================================ */
  /* 2. 翻牌后决策 (Postflop: Flop, Turn, River)                      */
  /* ================================================================ */
  const scenario = toScenario(seat.hole, state.board);
  const heroBest = evaluateBestHand([...state.board, ...seat.hole]);
  const handSummary = scenario ? summarizeFiveCardHand(scenario) : null;
  const boardAnalysis = analyzeBoardTexture(state.board);

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
    (handSummary?.pairPosition === 'overpair') ||
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

  /* ---------------------------------------------------------------- */
  /* 翻后分支 1：当前无人下注 (toCall === 0)                           */
  /* ---------------------------------------------------------------- */
  if (toCall === 0) {
    if (bets.length > 0) {
      // 1.1 坚果 / 超级大牌
      if (isNuts || (isMonster && estimate.equity >= 0.88)) {
        // 河牌全下收割
        if (state.street === 'river' && allin && roll < 0.65) {
          return makeDecision(
            allin,
            `手握坚果牌【${handDesc}】，河牌全下推入全部筹码收取最大价值！`,
          );
        }
        // 牌面极其干燥时，根据慢打倾向选择过牌设伏
        if (boardAnalysis.isDry && roll < persona.trap) {
          return makeDecision(
            check,
            `拿到优势大牌【${handDesc}】，牌面干燥无威胁，过牌设伏引诱对手进攻`,
          );
        }
        // 正常重注打价值
        const bigBet = bet(20) ?? bet(10);
        return makeDecision(
          bigBet,
          `手握坚果级【${handDesc}】，下注扩大底池收取价值`,
        );
      }

      // 1.2 强牌（两对、超对、顶对带强踢脚）
      if (isStrong) {
        // 翻前进攻方持续下注 (C-Bet)
        if (isPreflopAggressor && roll < persona.cbet) {
          const cbetAction = bet(10) ?? bet(20);
          return makeDecision(
            cbetAction,
            `作为翻前进攻方持续下注：手握【${handDesc}】，下注施压并收取薄价值`,
          );
        }
        if (roll < persona.aggression * 0.8) {
          const valBet = (persona.sizing > 0.6 ? bet(20) : bet(10)) ?? bet(5);
          return makeDecision(
            valBet,
            `手握强成牌【${handDesc}】，主动下注获取对手跟注价值`,
          );
        }
        return makeDecision(
          check,
          `手握【${handDesc}】，牌力占优但选择过牌控池`,
        );
      }

      // 1.3 强听牌（同花听牌 / 两头顺 / 组合听牌）半诈唬 (Semi-Bluff)
      if (hasStrongDraw) {
        if (roll < persona.semiBluff) {
          const semiBet = bet(10) ?? bet(5) ?? bet(20);
          return makeDecision(
            semiBet,
            `手握【${handDesc}】（强听牌），半诈唬下注争夺主动权，兼备弃牌率与补牌期望`,
          );
        }
        return makeDecision(
          check,
          `手握【${handDesc}】，过牌免费看下一张公共牌`,
        );
      }

      // 1.4 中等牌（中对、弱顶对）控池
      if (isMedium) {
        if (roll < persona.aggression * 0.25 && bets.some((b) => b.amount === 5)) {
          const probeBet = bet(5);
          if (probeBet) {
            return makeDecision(
              probeBet,
              `用中等牌【${handDesc}】下注 5 探针注，便宜探探对手虚实`,
            );
          }
        }
        return makeDecision(
          check,
          `手握【${handDesc}】，牌力中等，过牌控池避免做大底池`,
        );
      }

      // 1.5 翻前进攻方在干燥面用空气牌进行 C-Bet 诈唬
      if (
        isPreflopAggressor &&
        boardAnalysis.isDry &&
        state.street === 'flop' &&
        roll < persona.cbet * 0.8
      ) {
        const cbetBluff = bet(5) ?? bet(10);
        if (cbetBluff) {
          return makeDecision(
            cbetBluff,
            `翻牌面十分干燥，作为翻前进攻方打一枪持续下注尝试偷取底池`,
          );
        }
      }

      // 1.6 纯诈唬（在有利位置全场过牌时偷池）
      if (
        seatIndex === state.button &&
        state.board.length >= 3 &&
        roll < persona.bluff
      ) {
        const stealBet = bet(10) ?? bet(5);
        if (stealBet) {
          return makeDecision(
            stealBet,
            `全场过牌暴露虚弱，在庄家位下注尝试偷走底池`,
          );
        }
      }

      // 1.7 疯子选手抽风乱来 (Spaz)
      if (roll < persona.spaz) {
        const wildBet = bet(20) ?? allin;
        if (wildBet) {
          return makeDecision(
            wildBet,
            `打法奔放不可预测：顶格强行施压偷鸡！`,
          );
        }
      }
    }

    return makeDecision(check, `未击中牌面，过牌等待机会`);
  }

  /* ---------------------------------------------------------------- */
  /* 翻后分支 2：面临对手下注 / 加注 (toCall > 0)                      */
  /* ---------------------------------------------------------------- */

  // 针对上一位加注者风格的动态修正
  let aggrAdjust = 0;
  if (lastAggrPersona) {
    if (lastAggrPersona.key === 'rock' || lastAggrPersona.key === 'tight-aggressive') {
      aggrAdjust = 0.08; // 对手很紧，他的下注代表有真大牌，提高防守门槛
    } else if (lastAggrPersona.key === 'maniac' || lastAggrPersona.key === 'loose-aggressive') {
      aggrAdjust = -0.06; // 对手松凶/疯子，经常偷鸡，降低抓诈门槛
    }
  }

  // 2.1 坚果 / 怪物级大牌面对下注：反加注、全下或设伏
  if (isNuts || (isMonster && estimate.equity >= 0.85)) {
    // 翻后推入全下
    if (allin && (state.street === 'river' || estimate.equity >= 0.92) && roll < 0.75) {
      return makeDecision(
        allin,
        `手握绝对坚果【${handDesc}】，全下反击收割对手！`,
      );
    }
    // 反加注到 20
    if (bets.length > 0 && roll < 0.8) {
      const raiseMax = bet(20);
      if (raiseMax) {
        return makeDecision(
          raiseMax,
          `手握坚果牌【${handDesc}】，加注到 20 扩大战果！`,
        );
      }
    }
    // 跟注慢打（设陷阱）
    if (call && roll < persona.trap) {
      return makeDecision(
        call,
        `手握【${handDesc}】，跟注慢打设伏，等后街收网`,
      );
    }
    return makeDecision(call ?? allin, `手握坚果【${handDesc}】，跟注掌控底池`);
  }

  // 2.2 强牌（两对、超对、顶对带强踢脚）
  if (isStrong) {
    // 面对小额下注反加注
    if (toCall <= 10 && bets.length > 0 && roll < persona.aggression * 0.55) {
      const rAct = bet(20);
      if (rAct) {
        return makeDecision(
          rAct,
          `手握强牌【${handDesc}】，面对小注加注到 20 保护牌力并收取价值`,
        );
      }
    }
    // 对手是岩石老陈且下顶格注，若仅有一对且牌面极湿，考虑敬畏弃牌
    if (
      lastAggrPersona?.key === 'rock' &&
      toCall >= 20 &&
      handCategory <= HandCategory.OnePair &&
      roll < 0.6
    ) {
      return makeDecision(
        fold,
        `老陈风格极端保守，重注之下我的一对【${handDesc}】极度危险，理智弃牌`,
      );
    }
    return makeDecision(call, `手握强成牌【${handDesc}】，胜率占优，稳妥跟注`);
  }

  // 2.3 强听牌（同花/顺子/组合听牌）面对下注
  if (hasStrongDraw) {
    // 过牌-加注半诈唬 (Check-Raise)
    if (bets.length > 0 && roll < persona.checkRaise) {
      const crAct = bet(20);
      if (crAct) {
        return makeDecision(
          crAct,
          `手握【${handDesc}】，过牌-加注到 20 半诈唬，向对手施加最大弃牌压力！`,
        );
      }
    }
    // 根据底池赔率与潜在赔率跟注追牌
    const impliedEquity = estimate.equity + 0.08;
    if (impliedEquity >= potOdds - persona.callDown * 0.1) {
      return makeDecision(
        call,
        `手握【${handDesc}】（补牌充足），底池赔率合适，跟注追牌看下一张`,
      );
    }
    return makeDecision(fold, `听牌跟注成本过高，底池赔率不合算，理智弃牌`);
  }

  // 2.4 中等牌（中对、弱顶对、抓诈牌）
  if (isMedium) {
    // 跟注站（王姐）死不弃牌
    if (persona.callDown >= 0.75 && call) {
      return makeDecision(
        call,
        `跟注站风格：手里有【${handDesc}】舍不得扔，跟注看对手摊牌`,
      );
    }
    // 河牌面对松凶/疯子的抓诈唬 (Bluff Catch)
    if (
      state.street === 'river' &&
      (lastAggrPersona?.key === 'maniac' || lastAggrPersona?.key === 'loose-aggressive') &&
      call &&
      roll < 0.65
    ) {
      return makeDecision(
        call,
        `河牌听牌可能全部破产，对手大概率偷鸡，用【${handDesc}】抓诈跟注！`,
      );
    }
    // 常规底池赔率对比
    if (estimate.equity >= potOdds + style.callMargin + aggrAdjust) {
      return makeDecision(
        call,
        `底池赔率合适（需跟 ${toCall}，底池 ${(state.pot + toCall)}），中等成牌【${handDesc}】跟注`,
      );
    }
    return makeDecision(
      fold,
      `底池赔率不合适，手牌【${handDesc}】容易被对手压制，弃牌止损`,
    );
  }

  // 2.5 弱牌 / 听牌破产 / 空气牌
  if (isWeak && toCall <= 5 && potOdds <= 0.18 && call) {
    return makeDecision(call, `面对极小注，底池赔率诱人，便宜跟注看看`);
  }

  // 疯子绝境强力反扑 (Spaz)
  if (roll < persona.spaz * 0.6 && bets.length > 0) {
    const spazRaise = bet(20);
    if (spazRaise) {
      return makeDecision(
        spazRaise,
        `疯子本色：手握空气牌强行反加注到 20 偷鸡！`,
      );
    }
  }

  return makeDecision(fold, `牌面完全错过且面临下注，弃牌止损`);
}
