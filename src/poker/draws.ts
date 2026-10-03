/**
 * 后续听牌（draw）分析：转牌 / 河牌把「听牌」补成成牌的概率。
 *
 * 口径（全部由 47 张未知牌枚举推导，没有任何硬编码数字）：
 *
 * - 听牌目标只考虑两种「靠公共牌补成的成牌」：顺子、同花。
 * - 已知 5 张牌（Hero 2 + 翻牌 3，或对手 2 + 翻牌 3）里还没有目标牌型时：
 *     · 转牌：47（Hero）/ 45（对手，扣掉他自己 2 张）张里能直接补成目标的牌
 *       = 补牌（outs）。
 *     · 到河牌：池中任取 2 张（Hero C(47,2)=1081 / 对手 C(45,2)=990）视为等权
 *       后续，只要最终 7 张里出现目标牌型就算「补成」。
 *       因为牌力只可能随公共牌单调增强，所以「转牌补成」的路径同样计入。
 *     · 转牌无补牌、但两张后续牌能补成 → 后门听牌（backdoor）。
 * - 已经成型的牌型不算听牌（例如已有同花就不算「同花听牌」），
 *   成型判断直接看 5 张牌的花色张数 / 顺子掩码，而不是看牌型大小，
 *   因为葫芦、四条并不包含同花。
 */

import type { Card, FlopScenario, Rank, Suit } from './cards';
import { getRemainingDeck, RANK_VALUES, SUIT_SYMBOLS } from './cards';
import { enumerateOpponentHands } from './combinations';
import { HandCategory } from './evaluator';

/** 听牌目标：目前支持顺子与同花两种。 */
export type DrawTarget = HandCategory.Straight | HandCategory.Flush;

const DRAW_TARGETS: readonly DrawTarget[] = [
  HandCategory.Straight,
  HandCategory.Flush,
];

const SUIT_INDEX: Record<Suit, number> = { s: 0, h: 1, d: 2, c: 3 };

/** 点数 -> 13 位掩码里的位（2 -> bit0，…，A -> bit12）。 */
function rankBitOf(rank: Rank): number {
  return 1 << (RANK_VALUES[rank] - 2);
}

/**
 * 13 位点数掩码 -> 是否含 5 连张（A2345 轮子顺也算）。
 * 预计算 8192 种掩码，之后每次判断都是 O(1)。
 */
const STRAIGHT_MASK_TABLE: readonly boolean[] = (() => {
  const table = new Array<boolean>(1 << 13).fill(false);
  const wheel = (1 << 12) | 0b1111; // A + 2 3 4 5
  for (let mask = 0; mask < table.length; mask += 1) {
    let ok = (mask & wheel) === wheel;
    for (let low = 0; low <= 8 && !ok; low += 1) {
      const window = 0b11111 << low;
      if ((mask & window) === window) ok = true;
    }
    table[mask] = ok;
  }
  return table;
})();

function isFlushCounts(c0: number, c1: number, c2: number, c3: number): boolean {
  return c0 >= 5 || c1 >= 5 || c2 >= 5 || c3 >= 5;
}

export interface DrawCompletion {
  /** 转牌就能补成的牌，即补牌（outs）。 */
  outs: Card[];
  turnCount: number;
  turnTotal: number;
  turnProbability: number;
  riverCount: number;
  riverTotal: number;
  riverProbability: number;
}

/**
 * 一次遍历同时统计多个目标（以及它们的并集）的补成次数。
 *
 * 性能上做了两点特化（结果与逐张枚举完全一致）：
 * - 顺子判断走预计算的掩码表，O(1)；
 * - 5 张已知牌里最多只有一个花色能达到 3 张（否则需要 6 张牌），
 *   因此同花只可能由这个「同花候选花色」补成，只需数这个花色还差几张。
 *
 * @param base 已知 5 张牌
 * @param pool 后续未知牌池（Hero 47 张 / 对手 45 张）
 */
function countCompletions(
  base: readonly Card[],
  pool: readonly Card[],
  targets: readonly DrawTarget[],
): { perTarget: DrawCompletion[]; union: DrawCompletion } {
  let baseMask = 0;
  const baseCounts = [0, 0, 0, 0];
  for (const card of base) {
    baseMask |= rankBitOf(card.rank);
    baseCounts[SUIT_INDEX[card.suit]] += 1;
  }

  const trackStraight = targets.includes(HandCategory.Straight);
  const trackFlush = targets.includes(HandCategory.Flush);
  const straightIdx = targets.indexOf(HandCategory.Straight);
  const flushIdx = targets.indexOf(HandCategory.Flush);

  let flushSuitIndex = -1;
  for (let s = 0; s < 4; s += 1) {
    if (baseCounts[s] >= 3) flushSuitIndex = s;
  }
  const flushNeed = flushSuitIndex < 0 ? 0 : 5 - baseCounts[flushSuitIndex];
  const flushByOne = flushNeed === 1;

  const n = pool.length;
  const rankBits = new Int32Array(n);
  const flushCard = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    rankBits[i] = rankBitOf(pool[i].rank);
    if (flushSuitIndex >= 0 && SUIT_INDEX[pool[i].suit] === flushSuitIndex) {
      flushCard[i] = 1;
    }
  }

  const turnTotal = n;
  const riverTotal = (n * (n - 1)) / 2;
  const turnCounts = targets.map(() => 0);
  const riverCounts = targets.map(() => 0);
  const outs: Card[][] = targets.map(() => []);
  let unionTurn = 0;
  let unionRiver = 0;
  const unionOuts: Card[] = [];

  for (let i = 0; i < n; i += 1) {
    const sOk = trackStraight && STRAIGHT_MASK_TABLE[baseMask | rankBits[i]];
    const fOk = trackFlush && flushByOne && flushCard[i] === 1;
    if (sOk) {
      turnCounts[straightIdx] += 1;
      outs[straightIdx].push(pool[i]);
    }
    if (fOk) {
      turnCounts[flushIdx] += 1;
      outs[flushIdx].push(pool[i]);
    }
    if (sOk || fOk) {
      unionTurn += 1;
      unionOuts.push(pool[i]);
    }
  }

  for (let i = 0; i < n; i += 1) {
    const maskI = baseMask | rankBits[i];
    const fi = flushCard[i] === 1;
    for (let j = i + 1; j < n; j += 1) {
      const sOk = trackStraight && STRAIGHT_MASK_TABLE[maskI | rankBits[j]];
      const fOk =
        trackFlush &&
        (flushByOne ? fi || flushCard[j] === 1 : fi && flushCard[j] === 1);
      if (sOk) riverCounts[straightIdx] += 1;
      if (fOk) riverCounts[flushIdx] += 1;
      if (sOk || fOk) unionRiver += 1;
    }
  }

  const make = (count: number, river: number, outCards: Card[]): DrawCompletion => ({
    outs: outCards,
    turnCount: count,
    turnTotal,
    turnProbability: turnTotal === 0 ? 0 : count / turnTotal,
    riverCount: river,
    riverTotal,
    riverProbability: riverTotal === 0 ? 0 : river / riverTotal,
  });

  return {
    perTarget: targets.map((_, index) =>
      make(turnCounts[index], riverCounts[index], outs[index]),
    ),
    union: make(unionTurn, unionRiver, unionOuts),
  };
}

/** 已知 5 张牌里已经成型的听牌目标。 */
function madeTargets(base: readonly Card[]): Set<DrawTarget> {
  const made = new Set<DrawTarget>();
  let mask = 0;
  const counts = [0, 0, 0, 0];
  for (const card of base) {
    mask |= rankBitOf(card.rank);
    counts[SUIT_INDEX[card.suit]] += 1;
  }
  if (STRAIGHT_MASK_TABLE[mask]) made.add(HandCategory.Straight);
  if (isFlushCounts(counts[0], counts[1], counts[2], counts[3])) {
    made.add(HandCategory.Flush);
  }
  return made;
}

export type DrawKind =
  | 'flush'
  | 'straight-gutshot'
  | 'straight-open'
  | 'straight-multi';

export const DRAW_KIND_LABELS: Record<DrawKind, string> = {
  flush: '同花听牌',
  'straight-gutshot': '顺子听牌（卡顺）',
  'straight-open': '顺子听牌（两头顺）',
  'straight-multi': '顺子听牌（多卡口）',
};

interface BaseDraw {
  target: DrawTarget;
  /** 转牌无补牌，必须连来两张。 */
  backdoor: boolean;
  /** 补牌点数（去重，从大到小），同花听牌为空数组。 */
  outRanks: number[];
  /** 能补成该目标的牌所属花色（仅同花听牌）。 */
  flushSuit: Suit | null;
  kind: DrawKind;
  completion: DrawCompletion;
}

interface BaseDrawAnalysis {
  turnTotal: number;
  riverTotal: number;
  draws: BaseDraw[];
  union: DrawCompletion;
}

function analyzeBase(
  base: readonly Card[],
  pool: readonly Card[],
): BaseDrawAnalysis {
  const made = madeTargets(base);
  const targets = DRAW_TARGETS.filter((target) => !made.has(target));
  const counts = countCompletions(base, pool, targets);

  const draws: BaseDraw[] = [];
  targets.forEach((target, index) => {
    const completion = counts.perTarget[index];
    // 到河牌都补不成 → 不是听牌。
    if (completion.riverCount === 0) return;

    const outRanks = [
      ...new Set(completion.outs.map((card) => RANK_VALUES[card.rank])),
    ].sort((a, b) => b - a);
    let kind: DrawKind;
    let flushSuit: Suit | null = null;
    if (target === HandCategory.Flush) {
      kind = 'flush';
      const suitCounts = new Map<Suit, number>();
      for (const card of base) {
        suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
      }
      flushSuit =
        [...suitCounts.entries()].find(([, count]) => count >= 3)?.[0] ?? null;
    } else if (outRanks.length <= 1) {
      kind = 'straight-gutshot';
    } else if (outRanks.length === 2) {
      kind = 'straight-open';
    } else {
      kind = 'straight-multi';
    }

    draws.push({
      target,
      backdoor: completion.turnCount === 0,
      outRanks,
      flushSuit,
      kind,
      completion,
    });
  });

  return {
    turnTotal: pool.length,
    riverTotal: (pool.length * (pool.length - 1)) / 2,
    draws,
    union: counts.union,
  };
}

export interface HeroDrawRow {
  target: DrawTarget;
  kind: DrawKind;
  backdoor: boolean;
  label: string;
  outRanks: number[];
  completion: DrawCompletion;
}

export interface HeroDrawAnalysis {
  /** 转牌（Hero 为 47 张）。 */
  turnTotal: number;
  /** 转牌 + 河牌的组合数（Hero 为 C(47,2) = 1081）。 */
  riverTotal: number;
  /** 立即听牌在前、后门听牌在后，同类按补牌数从多到少。 */
  rows: HeroDrawRow[];
  immediateCount: number;
  backdoorCount: number;
  /** 至少补成一种听牌（含后门）。 */
  union: DrawCompletion;
}

function heroRow(draw: BaseDraw): HeroDrawRow {
  let label: string;
  if (draw.kind === 'flush') {
    const suit = draw.flushSuit ? SUIT_SYMBOLS[draw.flushSuit] : '';
    label = draw.backdoor ? `后门同花听牌 ${suit}` : `同花听牌 ${suit}`;
  } else if (draw.backdoor) {
    label = '后门顺子听牌';
  } else if (draw.kind === 'straight-multi') {
    label = `顺子听牌（${draw.outRanks.length} 个点数补牌）`;
  } else {
    label = DRAW_KIND_LABELS[draw.kind];
  }
  return {
    target: draw.target,
    kind: draw.kind,
    backdoor: draw.backdoor,
    label,
    outRanks: draw.outRanks,
    completion: draw.completion,
  };
}

export function analyzeHeroDraws(scenario: FlopScenario): HeroDrawAnalysis {
  const base = [...scenario.hero, ...scenario.flop];
  const pool = getRemainingDeck(scenario);
  const { draws, union, turnTotal, riverTotal } = analyzeBase(base, pool);

  const rows = draws
    .map(heroRow)
    .sort((a, b) => {
      if (a.backdoor !== b.backdoor) return a.backdoor ? 1 : -1;
      if (a.completion.outs.length !== b.completion.outs.length) {
        return b.completion.outs.length - a.completion.outs.length;
      }
      return b.completion.riverProbability - a.completion.riverProbability;
    });

  return {
    turnTotal,
    riverTotal,
    rows,
    immediateCount: rows.filter((row) => !row.backdoor).length,
    backdoorCount: rows.filter((row) => row.backdoor).length,
    union,
  };
}

export type OpponentDrawKind = DrawKind | 'backdoor';

export interface OpponentDrawRow {
  kind: OpponentDrawKind;
  label: string;
  /** 拥有该类听牌的对手组合数（同一组合可能同时计入多行）。 */
  comboCount: number;
  /** comboCount / 总组合数。 */
  probability: number;
  /** 该类组合在转牌补成的平均概率。 */
  averageTurnProbability: number;
  /** 该类组合到河牌补成的平均概率。 */
  averageRiverProbability: number;
  /** 拿到该类听牌并且到河牌真的补成的概率（占全部组合）。 */
  jointRiverProbability: number;
}

export interface OpponentDrawAnalysis {
  totalCombos: number;
  turnTotal: number;
  riverTotal: number;
  /** 至少有一种立即听牌（转牌有补牌）的组合数。 */
  immediateCombos: number;
  /** 没有立即听牌、只有后门听牌的组合数。 */
  backdoorOnlyCombos: number;
  /** 完全没有听牌的组合数。 */
  noDrawCombos: number;
  /** 立即听牌分类（可重叠），按组合数从多到少。 */
  rows: OpponentDrawRow[];
  backdoorRow: OpponentDrawRow | null;
  /** 对手拿到听牌并且在河牌前补成的概率（占全部随机手牌组合）。 */
  completeProbability: number;
  /** 在有听牌的对手组合里平均的补成率。 */
  completeConditionalProbability: number;
  /** 有听牌的对手组合数（= immediateCombos + backdoorOnlyCombos）。 */
  drawingCombos: number;
}

interface Accumulator {
  comboCount: number;
  turnSum: number;
  riverSum: number;
}

export function analyzeOpponentDraws(
  scenario: FlopScenario,
): OpponentDrawAnalysis {
  const remaining = getRemainingDeck(scenario);
  const hands = enumerateOpponentHands(remaining);
  const totalCombos = hands.length;
  const flop = scenario.flop;

  const byKind = new Map<DrawKind, Accumulator>();
  // 对手拿走后牌池固定少 2 张，所以后续总量对所有组合都一样。
  const turnTotal = remaining.length - 2;
  const riverTotal = (turnTotal * (turnTotal - 1)) / 2;
  let immediateCombos = 0;
  let backdoorOnlyCombos = 0;
  let drawingCombos = 0;
  let unionRiverSum = 0;
  let backdoorComboCount = 0;
  let backdoorRiverSum = 0;

  for (const hand of hands) {
    const pool = remaining.filter(
      (card) =>
        !(card.rank === hand[0].rank && card.suit === hand[0].suit) &&
        !(card.rank === hand[1].rank && card.suit === hand[1].suit),
    );
    const base = [hand[0], hand[1], flop[0], flop[1], flop[2]];
    const { draws, union } = analyzeBase(base, pool);
    if (draws.length === 0) continue;

    drawingCombos += 1;
    unionRiverSum += union.riverProbability;

    const immediate = draws.filter((draw) => !draw.backdoor);
    if (immediate.length > 0) {
      immediateCombos += 1;
      for (const draw of immediate) {
        const acc = byKind.get(draw.kind) ?? {
          comboCount: 0,
          turnSum: 0,
          riverSum: 0,
        };
        acc.comboCount += 1;
        acc.turnSum += draw.completion.turnProbability;
        acc.riverSum += draw.completion.riverProbability;
        byKind.set(draw.kind, acc);
      }
    } else {
      backdoorOnlyCombos += 1;
      backdoorComboCount += 1;
      backdoorRiverSum += union.riverProbability;
    }
  }

  const rows: OpponentDrawRow[] = [...byKind.entries()]
    .map(([kind, acc]) => ({
      kind,
      label: DRAW_KIND_LABELS[kind],
      comboCount: acc.comboCount,
      probability: acc.comboCount / totalCombos,
      averageTurnProbability: acc.turnSum / acc.comboCount,
      averageRiverProbability: acc.riverSum / acc.comboCount,
      jointRiverProbability: acc.riverSum / totalCombos,
    }))
    .sort((a, b) => b.comboCount - a.comboCount);

  const backdoorRow: OpponentDrawRow | null =
    backdoorComboCount === 0
      ? null
      : {
          kind: 'backdoor',
          label: '后门听牌（需连来两张）',
          comboCount: backdoorComboCount,
          probability: backdoorComboCount / totalCombos,
          averageTurnProbability: 0,
          averageRiverProbability: backdoorRiverSum / backdoorComboCount,
          jointRiverProbability: backdoorRiverSum / totalCombos,
        };

  return {
    totalCombos,
    turnTotal,
    riverTotal,
    immediateCombos,
    backdoorOnlyCombos,
    noDrawCombos: totalCombos - immediateCombos - backdoorOnlyCombos,
    rows,
    backdoorRow,
    completeProbability: unionRiverSum / totalCombos,
    completeConditionalProbability:
      drawingCombos === 0 ? 0 : unionRiverSum / drawingCombos,
    drawingCombos,
  };
}

export interface DrawAnalysis {
  hero: HeroDrawAnalysis;
  opponent: OpponentDrawAnalysis;
}

export function analyzeDraws(scenario: FlopScenario): DrawAnalysis {
  return {
    hero: analyzeHeroDraws(scenario),
    opponent: analyzeOpponentDraws(scenario),
  };
}
