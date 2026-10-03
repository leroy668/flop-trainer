/**
 * 翻牌牌型图鉴：把「Hero 2 张 + 翻牌 3 张」的全部 25,989,600 种等权组合，
 * 按「相似的牌型」归类，统计每一类出现的组合数与概率。全部由枚举推导，没有任何硬编码数字。
 *
 * 归类的三个维度（与训练器结果页的「当前 5 张牌」口径完全一致）：
 *   1. 已成牌：超对 / 顶对 / 中对 / 底对 / 小对子 / 公共牌对 / 两对 / 三条 / 顺子 / …
 *   2. 听牌：同花听牌 / 顺子听牌（卡顺・两头顺・多卡口）/ 后门同花 / 后门顺子
 *   3. 大类：强牌（顺子及以上）/ 成牌（一对・两对・三条）/
 *            听牌（高牌 + 立即听牌）/ 后门听牌（高牌 + 只有后门听牌）/ 空气
 *
 * 枚举口径：
 * - 5 张牌只由「点数的多重集合 + 每个点数用了哪些花色」决定。整体置换花色时，
 *   牌力、听牌、配对位置都不变，所以只枚举等价类（轨道）一次，再乘以轨道大小；
 *   2,598,960 个 5 张组合压缩成 134,459 个等价类。
 * - 每个等价类有 C(5,2)=10 种「哪两张是 Hero 底牌」的切分，10 种都要归类，
 *   所以总权重恰为 2,598,960 × 10 = 25,989,600。
 * - 顺子 / 同花 / 两对这类牌型与 Hero / 公共牌的切分无关（5 张牌的评价结果一样），
 *   每个等价类只评价一次；只有「一对」的位置（超对 / 顶对 / …）与切分有关。
 */

import type { Card, Rank, Suit } from './cards';
import { cardToString, RANKS, SUITS } from './cards';
import {
  HAND_CATEGORY_LABELS,
  HandCategory,
  evaluateFiveCards,
} from './evaluator';
import { isStraightMask, rankMaskBit } from './draws';
import { classifyPair, PAIR_POSITION_LABELS } from './handType';

/** 归类大类。 */
export type FlopTypeGroup =
  | 'premium'
  | 'made'
  | 'immediate-draw'
  | 'backdoor-draw'
  | 'air';

export const FLOP_TYPE_GROUPS: readonly FlopTypeGroup[] = [
  'premium',
  'made',
  'immediate-draw',
  'backdoor-draw',
  'air',
];

export const FLOP_TYPE_GROUP_LABELS: Record<FlopTypeGroup, string> = {
  premium: '强牌（顺子及以上）',
  made: '成牌（一对 / 两对 / 三条）',
  'immediate-draw': '听牌（高牌 + 立即听牌）',
  'backdoor-draw': '后门听牌（高牌 + 只有后门听牌）',
  air: '空气（高牌且没有听牌）',
};

export const FLOP_TYPE_GROUP_SHORT: Record<FlopTypeGroup, string> = {
  premium: '强牌',
  made: '成牌',
  'immediate-draw': '听牌',
  'backdoor-draw': '后门听牌',
  air: '空气',
};

const SUIT_INDEX: Record<Suit, number> = { s: 0, h: 1, d: 2, c: 3 };
const RANK_INDEX: Record<Rank, number> = RANKS.reduce(
  (acc, rank, index) => {
    acc[rank] = index;
    return acc;
  },
  {} as Record<Rank, number>,
);
const RANK_BITS = RANKS.map((rank) => rankMaskBit(rank));

/** 10 种「哪两张是底牌」的切分，预先算好下标。 */
const SPLITS: readonly {
  hero: [number, number];
  flop: [number, number, number];
}[] = (() => {
  const out: { hero: [number, number]; flop: [number, number, number] }[] = [];
  for (let i = 0; i < 5; i += 1) {
    for (let j = i + 1; j < 5; j += 1) {
      const flop = [0, 1, 2, 3, 4].filter(
        (index) => index !== i && index !== j,
      ) as [number, number, number];
      out.push({ hero: [i, j], flop });
    }
  }
  return out;
})();

export interface FlopTypeExample {
  hero: readonly [Card, Card];
  flop: readonly [Card, Card, Card];
  heroLabel: string;
  flopLabel: string;
}

/** 完整归类（已成牌 + 听牌）的一行。 */
export interface FlopTypeRow {
  /** 归类名，例如「顶对 + 同花听牌」。 */
  label: string;
  /** 已成牌名（一对细分到位置）。 */
  madeHand: string;
  category: HandCategory;
  categoryLabel: string;
  /** 听牌名（不含花色），立即听牌在前。 */
  draws: string[];
  group: FlopTypeGroup;
  hasImmediateDraw: boolean;
  hasBackdoorDraw: boolean;
  /** 等权组合数。 */
  count: number;
  /** count / total。 */
  probability: number;
  example: FlopTypeExample;
}

/** 合并听牌后的一行（只看已成牌；高牌再按听牌档位分三行）。 */
export interface FlopMadeRow {
  label: string;
  category: HandCategory;
  group: FlopTypeGroup;
  count: number;
  probability: number;
  /** 这一行里包含多少种完整归类。 */
  memberCount: number;
  /** 这一行包含的完整归类名（按组合数从多到少）。 */
  members: string[];
  example: FlopTypeExample;
}

export interface FlopGroupTotal {
  group: FlopTypeGroup;
  count: number;
  probability: number;
}

export interface FlopTaxonomy {
  /** 等价类数量。 */
  orbitCount: number;
  /** 等权组合总数（恒为 2,598,960 × 10）。 */
  total: number;
  /** 完整归类，按组合数从多到少。 */
  rows: FlopTypeRow[];
  /** 合并听牌后的归类，按组合数从多到少。 */
  madeRows: FlopMadeRow[];
  groupTotals: FlopGroupTotal[];
}

/* ------------------------------------------------------------------ *
 * 听牌结构
 * ------------------------------------------------------------------ */

interface Texture {
  key: string;
  labels: string[];
  immediate: boolean;
  backdoor: boolean;
}

/**
 * 5 张已知牌的听牌结构。与 draws.ts 的 analyzeHeroDraws 同口径：
 * 已成型的牌型不算听牌；立即听牌按补牌数排序；下一张补不了但两张能补 = 后门。
 */
interface StraightInfo {
  /** 能让顺子成型的「点数」个数（同一花色不细分）。 */
  outs: number;
  /** 下一张补不上、但再下一张能补上。 */
  backdoor: boolean;
}

/** 听牌结构只与点数掩码有关，缓存起来避免重复扫描（最多几千种掩码）。 */
const STRAIGHT_CACHE = new Map<number, StraightInfo>();

function straightInfoOf(mask: number): StraightInfo {
  const hit = STRAIGHT_CACHE.get(mask);
  if (hit !== undefined) return hit;
  let outs = 0;
  let backdoor = false;
  if (isStraightMask(mask)) {
    // 已经成顺，不算听牌
  } else {
    for (let bit = 0; bit < 13; bit += 1) {
      if ((mask & (1 << bit)) === 0 && isStraightMask(mask | (1 << bit))) {
        outs += 1;
      }
    }
    if (outs === 0) {
      for (let a = 0; a < 13 && !backdoor; a += 1) {
        if ((mask & (1 << a)) !== 0) continue;
        for (let b = a + 1; b < 13 && !backdoor; b += 1) {
          if ((mask & (1 << b)) !== 0) continue;
          if (isStraightMask(mask | (1 << a) | (1 << b))) backdoor = true;
        }
      }
    }
  }
  const info: StraightInfo = { outs, backdoor };
  STRAIGHT_CACHE.set(mask, info);
  return info;
}

function textureOf(cards: readonly Card[]): Texture {
  const counts = [0, 0, 0, 0];
  let mask = 0;
  for (const card of cards) {
    counts[SUIT_INDEX[card.suit]] += 1;
    mask |= RANK_BITS[RANK_INDEX[card.rank]];
  }

  const straightMade = isStraightMask(mask);
  const flushMade = counts.some((count) => count >= 5);
  let flushDrawSuit = -1;
  let flushBackdoorSuit = -1;
  counts.forEach((count, suit) => {
    if (count === 4) flushDrawSuit = suit;
    if (count === 3) flushBackdoorSuit = suit;
  });

  const straight = straightInfoOf(mask);
  const straightOutRanks = straight.outs;
  const backdoorStraight = straight.backdoor;

  const immediate: string[] = [];
  const backdoor: string[] = [];
  if (!flushMade && flushDrawSuit >= 0) immediate.push('同花听牌');
  if (!straightMade && straightOutRanks > 0) {
    immediate.push(
      straightOutRanks === 1
        ? '顺子听牌（卡顺）'
        : straightOutRanks === 2
          ? '顺子听牌（两头顺）'
          : `顺子听牌（${straightOutRanks} 个点数补牌）`,
    );
  }
  if (!flushMade && flushDrawSuit < 0 && flushBackdoorSuit >= 0) {
    backdoor.push('后门同花听牌');
  }
  if (backdoorStraight) backdoor.push('后门顺子听牌');

  const labels = [...immediate, ...backdoor];
  return {
    key: labels.join('|'),
    labels,
    immediate: immediate.length > 0,
    backdoor: backdoor.length > 0,
  };
}

/* ------------------------------------------------------------------ *
 * 等价类枚举
 * ------------------------------------------------------------------ */

const SUIT_PERMS: readonly number[][] = (() => {
  const out: number[][] = [];
  const rec = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    rest.forEach((value, index) => {
      rec([...prefix, value], [...rest.slice(0, index), ...rest.slice(index + 1)]);
    });
  };
  rec([], [0, 1, 2, 3]);
  return out;
})();

function permuteMask(perm: readonly number[], mask: number): number {
  let out = 0;
  for (let suit = 0; suit < 4; suit += 1) {
    if ((mask & (1 << suit)) !== 0) out |= 1 << perm[suit];
  }
  return out;
}

/** 点数多重集合（非递减，每个点数最多 4 张）。 */
function* rankPatterns(): Generator<number[]> {
  const acc: number[] = [];
  function* rec(start: number): Generator<number[]> {
    if (acc.length === 5) {
      yield acc.slice();
      return;
    }
    for (let rank = start; rank <= 12; rank += 1) {
      let repeats = 0;
      for (let i = acc.length - 1; i >= 0 && acc[i] === rank; i -= 1) repeats += 1;
      if (repeats >= 4) continue;
      acc.push(rank);
      yield* rec(rank);
      acc.pop();
    }
  }
  yield* rec(0);
}

/** 从 0..n-1 里取 k 个的全部组合（带缓存）。 */
const COMBINATION_CACHE = new Map<string, number[][]>();
function combinations(n: number, k: number): number[][] {
  const key = `${n}:${k}`;
  const hit = COMBINATION_CACHE.get(key);
  if (hit) return hit;
  const out: number[][] = [];
  const pick: number[] = [];
  const rec = (start: number): void => {
    if (pick.length === k) {
      out.push(pick.slice());
      return;
    }
    for (let i = start; i < n; i += 1) {
      pick.push(i);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  COMBINATION_CACHE.set(key, out);
  return out;
}

interface Orbit {
  cards: Card[];
  weight: number;
}

function subsetMask(subset: readonly number[]): number {
  let mask = 0;
  for (const suit of subset) mask |= 1 << suit;
  return mask;
}

function maskToSubset(mask: number): number[] {
  const out: number[] = [];
  for (let suit = 0; suit < 4; suit += 1) {
    if ((mask & (1 << suit)) !== 0) out.push(suit);
  }
  return out;
}

function compareSubset(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** 在稳定子 stab 下，subset 是否是它所在轨道里字典序最小的那个。 */
function isOrbitMinimal(subset: readonly number[], stab: readonly number[][]): boolean {
  const mask = subsetMask(subset);
  for (const perm of stab) {
    const image = maskToSubset(permuteMask(perm, mask));
    if (compareSubset(subset, image) > 0) return false;
  }
  return true;
}

/**
 * 逐个生成花色置换等价类的规范代表。
 *
 * 依次处理点数（从小到大），每个点数选一个花色集合；为保证每个等价类只出现一次，
 * 要求所选的集合在当前「前缀稳定子」（固定已经放好的牌的花色置换）下是所在轨道里
 * 字典序最小的那个。走到最后剩下的稳定子大小就是整副牌的稳定子，权重 = 24 / |稳定子|。
 */
function* canonicalOrbits(): Generator<Orbit> {
  for (const ranks of rankPatterns()) {
    const groups: { rank: number; size: number }[] = [];
    for (const rank of ranks) {
      const last = groups[groups.length - 1];
      if (last && last.rank === rank) last.size += 1;
      else groups.push({ rank, size: 1 });
    }

    const matched: { rank: number; suit: number }[] = [];

    function* rec(gi: number, stab: readonly number[][]): Generator<Orbit> {
      if (gi === groups.length) {
        const cards: Card[] = matched.map(({ rank, suit }) => ({
          rank: RANKS[rank],
          suit: SUITS[suit],
        }));
        yield { cards, weight: 24 / stab.length };
        return;
      }
      const group = groups[gi];
      for (const subset of combinations(4, group.size)) {
        if (!isOrbitMinimal(subset, stab)) continue;
        const mask = subsetMask(subset);
        const nextStab = stab.filter(
          (perm) => permuteMask(perm, mask) === mask,
        );
        for (const suit of subset) matched.push({ rank: group.rank, suit });
        yield* rec(gi + 1, nextStab);
        for (let i = 0; i < subset.length; i += 1) matched.pop();
      }
    }
    yield* rec(0, SUIT_PERMS);
  }
}

/* ------------------------------------------------------------------ *
 * 归类
 * ------------------------------------------------------------------ */

const AIR_LABEL = '空气（没有成牌，也没有听牌）';

function groupOf(category: HandCategory, texture: Texture): FlopTypeGroup {
  if (category >= HandCategory.Straight) return 'premium';
  if (category === HandCategory.HighCard) {
    if (texture.immediate) return 'immediate-draw';
    return texture.backdoor ? 'backdoor-draw' : 'air';
  }
  return 'made';
}

/** 合并听牌后的行名。 */
function mergeLabelOf(
  category: HandCategory,
  madeHand: string,
  texture: Texture,
): string {
  if (category !== HandCategory.HighCard) return madeHand;
  if (texture.immediate) return `${madeHand} + 立即听牌`;
  return texture.backdoor ? `${madeHand} + 后门听牌` : AIR_LABEL;
}

interface SplitInfo {
  madeHand: string;
  label: string;
  group: FlopTypeGroup;
}

function flopOf(
  cards: readonly Card[],
  indices: readonly [number, number, number],
): [Card, Card, Card] {
  return [cards[indices[0]], cards[indices[1]], cards[indices[2]]];
}

/** 某个切分（哪两张是 Hero 底牌）的归类。 */
function splitInfoOf(
  cards: readonly Card[],
  category: HandCategory,
  texture: Texture,
  heroIndices: readonly [number, number],
  flopIndices: readonly [number, number, number],
): SplitInfo {
  const hero: [Card, Card] = [cards[heroIndices[0]], cards[heroIndices[1]]];
  const madeHand =
    category === HandCategory.OnePair
      ? PAIR_POSITION_LABELS[
          classifyPair(hero, flopOf(cards, flopIndices))?.position ?? 'board-pair'
        ]
      : HAND_CATEGORY_LABELS[category];
  const label =
    category === HandCategory.HighCard && texture.labels.length === 0
      ? AIR_LABEL
      : [madeHand, ...texture.labels].join(' + ');
  return { madeHand, label, group: groupOf(category, texture) };
}

/** 单个切分的归类结果（供测试 / 其他页面复用）。 */
export interface FlopSplitSummary extends SplitInfo {
  category: HandCategory;
  categoryLabel: string;
  /** 听牌名（不含花色），立即听牌在前。 */
  draws: string[];
  hasImmediateDraw: boolean;
  hasBackdoorDraw: boolean;
}

/**
 * 把「5 张牌 + 哪两张是 Hero」归类成一句话，口径与结果页的
 * summarizeFiveCardHand 完全一致（只是同花听牌不带花色符号）。
 */
export function describeFlopSplit(
  cards: readonly Card[],
  heroIndices: readonly [number, number],
): FlopSplitSummary {
  const category = evaluateFiveCards(cards).category;
  const texture = textureOf(cards);
  const flopIndices = [0, 1, 2, 3, 4].filter(
    (index) => index !== heroIndices[0] && index !== heroIndices[1],
  ) as [number, number, number];
  const info = splitInfoOf(cards, category, texture, heroIndices, flopIndices);
  return {
    ...info,
    category,
    categoryLabel: HAND_CATEGORY_LABELS[category],
    draws: [...texture.labels],
    hasImmediateDraw: texture.immediate,
    hasBackdoorDraw: texture.backdoor,
  };
}

export interface FlopTaxonomyScanner {
  /** 等价类总数（进度条用）。 */
  orbitTotal: number;
  /** 已处理的等价类数量。 */
  processed: number;
  done: boolean;
  /** 处理至多 budget 个等价类。 */
  advance(budget: number): void;
  result(): FlopTaxonomy;
}

/** 分片枚举器：UI 分多次调用 advance()，避免长时间卡住主线程。 */
export function createFlopTaxonomyScanner(): FlopTaxonomyScanner {
  const orbitTotal = [...rankPatterns()].length;
  const iterator = canonicalOrbits();
  const rows = new Map<string, { row: FlopTypeRow; score: number }>();
  const merges = new Map<
    string,
    { row: FlopMadeRow; score: number; labels: Set<string> }
  >();
  let processed = 0;
  let orbitWeight = 0;
  let done = false;

  const consume = (orbit: Orbit): void => {
    const cards = orbit.cards;
    const category = evaluateFiveCards(cards).category;
    const texture = textureOf(cards);
    const group = groupOf(category, texture);
    const categoryLabel = HAND_CATEGORY_LABELS[category];
    const score = cards.reduce((sum, card) => sum + RANK_INDEX[card.rank], 0);
    const weight = orbit.weight;
    orbitWeight += weight;

    for (const split of SPLITS) {
      const info = splitInfoOf(cards, category, texture, split.hero, split.flop);
      const { madeHand, label } = info;
      const makeExample = (): FlopTypeExample => {
        const hero: [Card, Card] = [cards[split.hero[0]], cards[split.hero[1]]];
        const flop = flopOf(cards, split.flop);
        return {
          hero,
          flop,
          heroLabel: `${cardToString(hero[0])} ${cardToString(hero[1])}`,
          flopLabel: flop.map(cardToString).join(' '),
        };
      };

      const row = rows.get(label);
      if (row === undefined) {
        rows.set(label, {
          score,
          row: {
            label,
            madeHand,
            category,
            categoryLabel,
            draws: texture.labels,
            group,
            hasImmediateDraw: texture.immediate,
            hasBackdoorDraw: texture.backdoor,
            count: weight,
            probability: 0,
            example: makeExample(),
          },
        });
      } else {
        row.row.count += weight;
        if (score > row.score) {
          row.score = score;
          row.row.example = makeExample();
        }
      }

      const merge = mergeLabelOf(category, madeHand, texture);
      const mergeRow = merges.get(merge);
      if (mergeRow === undefined) {
        merges.set(merge, {
          score,
          labels: new Set([label]),
          row: {
            label: merge,
            category,
            group,
            count: weight,
            probability: 0,
            memberCount: 1,
            members: [],
            example: makeExample(),
          },
        });
      } else {
        mergeRow.row.count += weight;
        mergeRow.labels.add(label);
        if (score > mergeRow.score) {
          mergeRow.score = score;
          mergeRow.row.example = makeExample();
        }
      }
    }
  };

  return {
    orbitTotal,
    get processed() {
      return processed;
    },
    get done() {
      return done;
    },
    advance(budget: number): void {
      if (done) return;
      let count = 0;
      while (count < budget) {
        const next = iterator.next();
        if (next.done) {
          done = true;
          break;
        }
        consume(next.value);
        processed += 1;
        count += 1;
      }
    },
    result(): FlopTaxonomy {
      const total = orbitWeight * 10;
      const list = [...rows.values()].map((bucket) => bucket.row);
      list.forEach((row) => {
        row.probability = total === 0 ? 0 : row.count / total;
      });
      list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

      const madeRows = [...merges.values()].map((bucket) => {
        const members = [...bucket.labels]
          .map((label) => ({ label, count: rows.get(label)?.row.count ?? 0 }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
          .map((entry) => entry.label);
        return { ...bucket.row, memberCount: members.length, members };
      });
      madeRows.forEach((row) => {
        row.probability = total === 0 ? 0 : row.count / total;
      });
      madeRows.sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label),
      );

      const groupTotals = FLOP_TYPE_GROUPS.map((group) => {
        const count = madeRows
          .filter((row) => row.group === group)
          .reduce((sum, row) => sum + row.count, 0);
        return { group, count, probability: total === 0 ? 0 : count / total };
      });

      return {
        orbitCount: processed,
        total,
        rows: list,
        madeRows,
        groupTotals,
      };
    },
  };
}

/** 一次跑完（测试 / Node 脚本用）。 */
export function buildFlopTaxonomy(): FlopTaxonomy {
  const scanner = createFlopTaxonomyScanner();
  scanner.advance(Number.POSITIVE_INFINITY);
  return scanner.result();
}
