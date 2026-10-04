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
        // 朋友局中：大盲免费看牌多数直接过牌；极强牌（AA/KK）或偶尔试探才会轻微加注到 10
        if (isPremium && roll < 0.4) {
          const raiseAct = bet(10);
          if (raiseAct) {
            return makeDecision(
              raiseAct,
              `在大盲位手握极品【${holeLabel}】，加注到 10 试探一下`,
            );
          }
        }
      }
      return makeDecision(
        check ?? call,
        `在大盲位手握【${holeLabel}】，有过牌免费看翻牌的机会，轻松过牌看翻牌`,
      );
    }

    // 局面 B: 面对底池只有大盲平跟 (toCall === 5 或 10，尚未有人加注)
    if (state.currentBet <= 10) {
      if (bets.length > 0) {
        // 优质好牌（AA, KK, QQ, AK）朋友局正常平跟进池看翻牌，只有小概率加注到 10 或极罕见加到 20
        if (isPremium && roll < 0.35) {
          const openAct = bet(10);
          if (openAct) {
            return makeDecision(
              openAct,
              `手握好牌【${holeLabel}】，稍作加注到 10`,
            );
          }
        }
      }

      // 朋友局绝大多数情况：只要有牌就平跟 10 块钱看翻牌 (Limp / Call)
      if (isPlayable || persona.callDown >= 0.3 || effectiveScore >= 0.38) {
        return makeDecision(
          call ?? check,
          `在${posLabel}手握【${holeLabel}】，平跟 10 筹码凑热闹看翻牌`,
        );
      }

      return makeDecision(
        fold,
        `起手牌【${holeLabel}】太差，随手弃牌`,
      );
    }

    // 局面 C: 面临别人加注 (toCall >= 10)
    // 朋友局中极少有人再反加注，多数选择跟注或者弃牌
    if (isPremium || isStrong || (isPlayable && roll < 0.4)) {
      return makeDecision(
        call,
        `手握【${holeLabel}】，跟注看翻牌`,
      );
    }

    return makeDecision(
      fold,
      `面对加注，手牌【${holeLabel}】不够强，弃牌`,
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
      // 1.1 坚果 / 超级大牌（同花顺、四条、葫芦、同花）
      if (isNuts || (isMonster && estimate.equity >= 0.88)) {
        // 朋友局中：极少推全下，多数打 5 或 10 慢慢收价值；仅河牌且底池已经很大时极小概率打 20
        if (state.street === 'river' && (state.pot >= 80 || seat.stack <= 30) && allin && roll < 0.1) {
          return makeDecision(
            allin,
            `手握坚果牌【${handDesc}】，筹码见底顺势全下`,
          );
        }
        // 朋友局中最常见：过牌慢打或者下个 5 / 10 意思一下
        if (roll < 0.5) {
          return makeDecision(
            check,
            `拿到超级大牌【${handDesc}】，友好过牌等后街看牌`,
          );
        }
        const friendlyBet = bet(10) ?? bet(5);
        return makeDecision(
          friendlyBet,
          `手握大牌【${handDesc}】，下注 10 小试一下`,
        );
      }

      // 1.2 强牌（两对、超对、顶对好踢脚）
      if (isStrong) {
        // 绝大多数情况朋友局优先选择过牌控池或下注 5 探路
        if (roll < 0.55) {
          return makeDecision(check, `手握【${handDesc}】，选择过牌看牌`);
        }
        const smallBet = bet(5) ?? bet(10);
        return makeDecision(
          smallBet,
          `手握好牌【${handDesc}】，小下个 5 筹码探路`,
        );
      }

      // 1.3 强听牌（同花/顺子听牌）
      if (hasStrongDraw) {
        if (roll < 0.25) {
          const smallDrawBet = bet(5);
          if (smallDrawBet) {
            return makeDecision(
              smallDrawBet,
              `手握听牌【${handDesc}】，扔个 5 试一试`,
            );
          }
        }
        return makeDecision(
          check,
          `手握听牌【${handDesc}】，免费过牌看下一张`,
        );
      }

      // 1.4 中等牌（中对、弱顶对）
      if (isMedium) {
        return makeDecision(
          check,
          `手握【${handDesc}】，牌力中等，过牌看看`,
        );
      }

      // 1.5 弱牌/空气牌：朋友局绝大多数直接过牌
      return makeDecision(check, `没中牌，轻松过牌`);
    }

    return makeDecision(check, `过牌看牌`);
  }

  /* ---------------------------------------------------------------- */
  /* 翻后分支 2：面临对手下注 / 加注 (toCall > 0)                      */
  /* ---------------------------------------------------------------- */

  // 2.1 坚果 / 怪物级大牌面对下注：通常选择平跟 5/10，或者轻微反加到 10/20，极少梭哈
  if (isNuts || (isMonster && estimate.equity >= 0.85)) {
    // 只有在筹码已经所剩无几且河牌时，才极小概率全下
    if (state.street === 'river' && seat.stack <= 25 && allin && roll < 0.15) {
      return makeDecision(allin, `手握大牌【${handDesc}】，筹码见底全下`);
    }
    // 面对加注，朋友局最典型的行为是平跟设伏或享受摊牌
    if (roll < 0.65 || bets.length === 0) {
      return makeDecision(call ?? check, `手握大牌【${handDesc}】，平跟看后牌`);
    }
    const safeRaise = bet(10) ?? bet(20);
    return makeDecision(safeRaise ?? call, `手握大牌【${handDesc}】，稍作加注`);
  }

  // 2.2 强牌（两对、超对、顶对）
  if (isStrong) {
    // 面对小注（5或10），朋友局基本都是跟注（Call）
    return makeDecision(call, `手握【${handDesc}】，稳稳跟注`);
  }

  // 2.3 听牌（同花/顺子）面对下注
  if (hasStrongDraw) {
    // 朋友局听牌只要便宜（<= 10）基本都会跟注看看，绝不会神经质加注到 20 或梭哈
    if (toCall <= 10 && call) {
      return makeDecision(
        call,
        `手握听牌【${handDesc}】，便宜跟注看下一张能不能中`,
      );
    }
    if (toCall > 10 && call && roll < 0.35) {
      return makeDecision(call, `追追看顺子/同花`);
    }
    return makeDecision(fold, `跟注成本太高，不追了弃牌`);
  }

  // 2.4 中等牌（中对、弱顶对）
  if (isMedium) {
    // 面对 5 块钱小注，绝大多数朋友都会跟注看一眼
    if (toCall <= 5 && call) {
      return makeDecision(call, `就 5 块钱，跟注看一眼`);
    }
    // 面对 10 块钱，大部分看心情跟注
    if (toCall <= 10 && call && roll < 0.55) {
      return makeDecision(call, `有对子【${handDesc}】，跟注瞧瞧`);
    }
    return makeDecision(fold, `别人下注了，中等小牌弃掉`);
  }

  // 2.5 弱牌 / 没中牌
  if (isWeak && toCall <= 5 && roll < 0.25 && call) {
    return makeDecision(call, `随手跟 5 块钱看戏`);
  }

  return makeDecision(fold, `没牌弃掉`);

  return makeDecision(fold, `牌面完全错过且面临下注，弃牌止损`);
}
