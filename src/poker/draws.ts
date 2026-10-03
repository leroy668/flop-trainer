/**
 * 后续听牌（draw）分析：还没发出的公共牌把「听牌」补成成牌的概率。
 *
 * 口径（全部由剩余未知牌枚举推导，没有任何硬编码数字）：
 *
 * - 听牌目标只考虑两种「靠公共牌补成的成牌」：顺子、同花。
 * - 已知牌（翻牌 5 张 / 转牌 6 张 / 河牌 7 张）里还没有目标牌型时：
 *     · 下一张牌：Hero 47 / 46 张（对手 45 / 44 张，扣掉他自己 2 张）
 *       里能直接补成目标的牌 = 补牌（outs）。
 *     · 发完为止：从池中取完剩余公共牌（翻牌后 2 张：C(47,2)=1081 /
 *       C(45,2)=990；转牌后 1 张：46 / 44）视为等权后续，
 *       只要最终出现目标牌型就算「补成」。
 *       因为牌力只可能随公共牌单调增强，所以「下一张就补成」的路径同样计入。
 *     · 下一张无补牌、但后面两张能补成 → 后门听牌（backdoor，只在翻牌后成立）。
 *     · 河牌已发完 → 没有后续牌，不存在听牌。
 * - 已经成型的牌型不算听牌（例如已有同花就不算「同花听牌」），
 *   成型判断直接看已知牌的花色张数 / 顺子掩码，而不是看牌型大小，
 *   因为葫芦、四条并不包含同花。
 *
 * 注意：转牌 / 河牌时已知牌有 6~7 张，此时「翻牌时的短板」可能已经被补上，
 * 目标集合与补牌数会随牌面变化，所以每一手牌都重新算。
 */

import type { Card, Rank, Scenario, Street, Suit } from './cards';
import {
  boardCards,
  getRemainingDeck,
  knownCards,
  RANK_VALUES,
  remainingBoardCards,
  streetOf,
  SUIT_SYMBOLS,
} from './cards';
import { enumerateOpponentHands, pairCount } from './combinations';
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
  /** 下一张公共牌就能补成的牌，即补牌（outs）。 */
  outs: Card[];
  /** 下一张公共牌（转牌 / 河牌）就能补成：补牌数 / 未知牌池张数。 */
  nextCount: number;
  nextTotal: number;
  nextProbability: number;
  /** 剩余公共牌全部发完前补成：组合数 / 等权后续总数。 */
  finalCount: number;
  finalTotal: number;
  finalProbability: number;
}

/**
 * 一次遍历同时统计多个目标（以及它们的并集）的补成次数。
 *
 * 性能上做了两点特化（结果与逐张枚举完全一致）：
 * - 顺子判断走预计算的掩码表，O(1)；
 * - 5 张已知牌里最多只有一个花色能达到 3 张（否则需要 6 张牌），
 *   因此同花只可能由这个「同花候选花色」补成，只需数这个花色还差几张。
 *
 * @param base 已知牌（翻牌 5 张 / 转牌 6 张）
 * @param pool 后续未知牌池（Hero 47 / 46 张，对手 45 / 44 张）
 * @param remainingBoard 还要发几张公共牌（2 或 1）
 */
function countCompletions(
  base: readonly Card[],
  pool: readonly Card[],
  targets: readonly DrawTarget[],
  remainingBoard: number,
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

  const nextTotal = n;
  // 只发一张（转牌后）时，「发完」与「下一张」是同一批牌。
  const finalTotal = remainingBoard >= 2 ? pairCount(n) : n;
  const nextCounts = targets.map(() => 0);
  const finalCounts = targets.map(() => 0);
  const outs: Card[][] = targets.map(() => []);
  let unionNext = 0;
  let unionFinal = 0;
  const unionOuts: Card[] = [];

  for (let i = 0; i < n; i += 1) {
    const sOk = trackStraight && STRAIGHT_MASK_TABLE[baseMask | rankBits[i]];
    const fOk = trackFlush && flushByOne && flushCard[i] === 1;
    if (sOk) {
      nextCounts[straightIdx] += 1;
      outs[straightIdx].push(pool[i]);
    }
    if (fOk) {
      nextCounts[flushIdx] += 1;
      outs[flushIdx].push(pool[i]);
    }
    if (sOk || fOk) {
      unionNext += 1;
      unionOuts.push(pool[i]);
    }
  }

  if (remainingBoard >= 2) {
    for (let i = 0; i < n; i += 1) {
      const maskI = baseMask | rankBits[i];
      const fi = flushCard[i] === 1;
      for (let j = i + 1; j < n; j += 1) {
        const sOk = trackStraight && STRAIGHT_MASK_TABLE[maskI | rankBits[j]];
        const fOk =
          trackFlush &&
          (flushByOne ? fi || flushCard[j] === 1 : fi && flushCard[j] === 1);
        if (sOk) finalCounts[straightIdx] += 1;
        if (fOk) finalCounts[flushIdx] += 1;
        if (sOk || fOk) unionFinal += 1;
      }
    }
  } else {
    // 只剩一张牌可发：「发完」就是「下一张」，逐目标拷一份即可。
    unionFinal = unionNext;
    targets.forEach((_, index) => {
      finalCounts[index] = nextCounts[index];
    });
  }

  const make = (next: number, final: number, outCards: Card[]): DrawCompletion => ({
    outs: outCards,
    nextCount: next,
    nextTotal,
    nextProbability: nextTotal === 0 ? 0 : next / nextTotal,
    finalCount: final,
    finalTotal,
    finalProbability: finalTotal === 0 ? 0 : final / finalTotal,
  });

  return {
    perTarget: targets.map((_, index) =>
      make(nextCounts[index], finalCounts[index], outs[index]),
    ),
    union: make(unionNext, unionFinal, unionOuts),
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

/** 后门听牌：下一张牌无补牌，但后面两张能补成。 */
interface BaseDraw {
  target: DrawTarget;
  /** 下一张牌没有补牌，必须连来两张。 */
  backdoor: boolean;
  /** 补牌点数（去重，从大到小），同花听牌为空数组。 */
  outRanks: number[];
  /** 能补成该目标的牌所属花色（仅同花听牌）。 */
  flushSuit: Suit | null;
  kind: DrawKind;
  completion: DrawCompletion;
}

interface BaseDrawAnalysis {
  /** 还要发几张公共牌。 */
  remainingBoardCards: number;
  nextTotal: number;
  finalTotal: number;
  draws: BaseDraw[];
  union: DrawCompletion;
}

function analyzeBase(
  base: readonly Card[],
  pool: readonly Card[],
  remainingBoard: number,
): BaseDrawAnalysis {
  const made = madeTargets(base);
  const targets = DRAW_TARGETS.filter((target) => !made.has(target));
  const counts = countCompletions(base, pool, targets, remainingBoard);

  const draws: BaseDraw[] = [];
  targets.forEach((target, index) => {
    const completion = counts.perTarget[index];
    // 发完都补不成 → 不是听牌。
    if (completion.finalCount === 0) return;

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
      backdoor: remainingBoard >= 2 && completion.nextCount === 0,
      outRanks,
      flushSuit,
      kind,
      completion,
    });
  });

  return {
    remainingBoardCards: remainingBoard,
    nextTotal: pool.length,
    finalTotal: remainingBoard >= 2 ? pairCount(pool.length) : pool.length,
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
  /** 还要发几张公共牌（2 / 1 / 0）。 */
  remainingBoardCards: number;
  /** 河牌已发完 → 不存在后续听牌。 */
  finished: boolean;
  /** 下一张牌的总张数（Hero 翻牌 47 / 转牌 46）。 */
  nextTotal: number;
  /** 发完为止的等权后续总数（Hero 翻牌 C(47,2)=1081 / 转牌 46）。 */
  finalTotal: number;
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

export function analyzeHeroDraws(scenario: Scenario): HeroDrawAnalysis {
  const base = knownCards(scenario);
  const pool = getRemainingDeck(scenario);
  const remainingBoard = remainingBoardCards(scenario);
  const { draws, union, nextTotal, finalTotal } = analyzeBase(
    base,
    pool,
    remainingBoard,
  );

  const rows = draws
    .map(heroRow)
    .sort((a, b) => {
      if (a.backdoor !== b.backdoor) return a.backdoor ? 1 : -1;
      if (a.completion.outs.length !== b.completion.outs.length) {
        return b.completion.outs.length - a.completion.outs.length;
      }
      return b.completion.finalProbability - a.completion.finalProbability;
    });

  return {
    remainingBoardCards: remainingBoard,
    finished: remainingBoard === 0,
    nextTotal,
    finalTotal,
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
  /** 该类组合在下一张牌补成的平均概率。 */
  averageNextProbability: number;
  /** 该类组合在发完前补成的平均概率。 */
  averageFinalProbability: number;
  /** 拿到该类听牌并且真的补成的概率（占全部组合）。 */
  jointFinalProbability: number;
}

export interface OpponentDrawAnalysis {
  totalCombos: number;
  /** 还要发几张公共牌（2 / 1 / 0）。 */
  remainingBoardCards: number;
  /** 河牌已发完 → 不存在后续听牌。 */
  finished: boolean;
  /** 对手拿走后剩余牌数（45 / 44 / 43）。 */
  nextTotal: number;
  /** 发完为止的等权后续总数（翻牌 C(45,2)=990 / 转牌 44）。 */
  finalTotal: number;
  /** 至少有一种立即听牌（下一张牌有补牌）的组合数。 */
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
  nextSum: number;
  finalSum: number;
}

export function analyzeOpponentDraws(
  scenario: Scenario,
): OpponentDrawAnalysis {
  const board = boardCards(scenario);
  const remainingBoard = remainingBoardCards(scenario);
  const remaining = getRemainingDeck(scenario);
  const hands = enumerateOpponentHands(remaining);
  const totalCombos = hands.length;

  const byKind = new Map<DrawKind, Accumulator>();
  // 对手拿走后牌池固定少 2 张，所以后续总量对所有组合都一样。
  const nextTotal = remaining.length - 2;
  const finalTotal = remainingBoard >= 2 ? pairCount(nextTotal) : nextTotal;
  let immediateCombos = 0;
  let backdoorOnlyCombos = 0;
  let drawingCombos = 0;
  let unionFinalSum = 0;
  let backdoorComboCount = 0;
  let backdoorFinalSum = 0;

  for (const hand of hands) {
    const pool = remaining.filter(
      (card) =>
        !(card.rank === hand[0].rank && card.suit === hand[0].suit) &&
        !(card.rank === hand[1].rank && card.suit === hand[1].suit),
    );
    const base = [...hand, ...board];
    const { draws, union } = analyzeBase(base, pool, remainingBoard);
    if (draws.length === 0) continue;

    drawingCombos += 1;
    unionFinalSum += union.finalProbability;

    const immediate = draws.filter((draw) => !draw.backdoor);
    if (immediate.length > 0) {
      immediateCombos += 1;
      for (const draw of immediate) {
        const acc = byKind.get(draw.kind) ?? {
          comboCount: 0,
          nextSum: 0,
          finalSum: 0,
        };
        acc.comboCount += 1;
        acc.nextSum += draw.completion.nextProbability;
        acc.finalSum += draw.completion.finalProbability;
        byKind.set(draw.kind, acc);
      }
    } else {
      backdoorOnlyCombos += 1;
      backdoorComboCount += 1;
      backdoorFinalSum += union.finalProbability;
    }
  }

  const rows: OpponentDrawRow[] = [...byKind.entries()]
    .map(([kind, acc]) => ({
      kind,
      label: DRAW_KIND_LABELS[kind],
      comboCount: acc.comboCount,
      probability: acc.comboCount / totalCombos,
      averageNextProbability: acc.nextSum / acc.comboCount,
      averageFinalProbability: acc.finalSum / acc.comboCount,
      jointFinalProbability: acc.finalSum / totalCombos,
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
          averageNextProbability: 0,
          averageFinalProbability: backdoorFinalSum / backdoorComboCount,
          jointFinalProbability: backdoorFinalSum / totalCombos,
        };

  return {
    totalCombos,
    remainingBoardCards: remainingBoard,
    finished: remainingBoard === 0,
    nextTotal,
    finalTotal,
    immediateCombos,
    backdoorOnlyCombos,
    noDrawCombos: totalCombos - immediateCombos - backdoorOnlyCombos,
    rows,
    backdoorRow,
    completeProbability: unionFinalSum / totalCombos,
    completeConditionalProbability:
      drawingCombos === 0 ? 0 : unionFinalSum / drawingCombos,
    drawingCombos,
  };
}

export interface DrawAnalysis {
  hero: HeroDrawAnalysis;
  opponent: OpponentDrawAnalysis;
}

export function analyzeDraws(scenario: Scenario): DrawAnalysis {
  // 河牌已经发完：没有后续公共牌，听牌概念不存在（也省掉一次全枚举）。
  if (remainingBoardCards(scenario) === 0) {
    const nextTotal = getRemainingDeck(scenario).length - 2;
    const totalCombos = pairCount(nextTotal + 2);
    return {
      hero: {
        remainingBoardCards: 0,
        finished: true,
        nextTotal: 0,
        finalTotal: 0,
        rows: [],
        immediateCount: 0,
        backdoorCount: 0,
        union: {
          outs: [],
          nextCount: 0,
          nextTotal: 0,
          nextProbability: 0,
          finalCount: 0,
          finalTotal: 0,
          finalProbability: 0,
        },
      },
      opponent: {
        totalCombos,
        remainingBoardCards: 0,
        finished: true,
        nextTotal,
        finalTotal: nextTotal,
        immediateCombos: 0,
        backdoorOnlyCombos: 0,
        noDrawCombos: totalCombos,
        rows: [],
        backdoorRow: null,
        completeProbability: 0,
        completeConditionalProbability: 0,
        drawingCombos: 0,
      },
    };
  }

  return {
    hero: analyzeHeroDraws(scenario),
    opponent: analyzeOpponentDraws(scenario),
  };
}
