/**
 * 牌面结构图鉴：把全部 22,100 种翻牌（C(52,3)）按「牌面结构」归类。
 * 全部由枚举推导 —— 没有任何写死的表格。
 *
 * 三个层级（同一份枚举，三种合并力度）：
 *   strategic（策略牌面，1,755 类）
 *     整体置换 4 种花色后相同算一类（点数保留）。
 *     这正是 GTO 软件建库时说的「策略上不同的翻牌」：1755 个牌面就能代表全部 22,100 种。
 *   shape（牌面形状，379 类）
 *     再把点数整体平移也合并：K72 与 Q63 视为同一种「形状」，
 *     只剩「带不带对 + 跨度 + 哪些位置同花」。
 *   coarse（形状 × 花色，247 类）
 *     在 shape 基础上只分单色 / 两色 / 彩虹。
 *
 * 类的权重 = 该类包含多少种具体翻牌，占比 = 权重 / 22,100。
 *
 * 术语：
 *   pairing      无对 / 带对 / 三条
 *   suitClass    单色（3 张同花）/ 两色（有且只有两张同花）/ 彩虹（三张不同花）
 *   structure    连张结构：三连张 / 两连张 / 隔一张 / 不连；带对时看踢脚与对子的距离
 */

import type { Card, Rank, Suit } from './cards';
import { cardToString, createDeck, RANKS, RANK_VALUES } from './cards';

export type BoardPairing = 'unpaired' | 'pair' | 'trips';

export type BoardSuitClass = 'monotone' | 'two-tone' | 'rainbow';

export type BoardTextureLevel = 'strategic' | 'shape' | 'coarse';

export const BOARD_TEXTURE_LEVELS: readonly BoardTextureLevel[] = [
  'strategic',
  'shape',
  'coarse',
];

export const BOARD_TEXTURE_LEVEL_LABELS: Record<BoardTextureLevel, string> = {
  strategic: '策略牌面',
  shape: '牌面形状',
  coarse: '形状 × 花色',
};

export const BOARD_TEXTURE_LEVEL_HINTS: Record<BoardTextureLevel, string> = {
  strategic: '点数保留 · 花色等价',
  shape: '点数平移等价',
  coarse: '只分单色 / 两色 / 彩虹',
};

export const PAIRING_LABELS: Record<BoardPairing, string> = {
  unpaired: '无对',
  pair: '带对',
  trips: '三条',
};

export const PAIRING_ORDER: readonly BoardPairing[] = ['unpaired', 'pair', 'trips'];

export const SUIT_CLASS_LABELS: Record<BoardSuitClass, string> = {
  monotone: '单色',
  'two-tone': '两色',
  rainbow: '彩虹',
};

export const SUIT_CLASS_SHORT: Record<BoardSuitClass, string> = {
  monotone: '单色',
  'two-tone': '两色',
  rainbow: '彩虹',
};

export const SUIT_CLASS_ORDER: readonly BoardSuitClass[] = [
  'two-tone',
  'rainbow',
  'monotone',
];

export type BoardStructure =
  | 'triple-run'
  | 'double-run'
  | 'one-gapper'
  | 'disconnected'
  | 'kicker-adjacent'
  | 'kicker-one-gap'
  | 'kicker-far'
  | 'trips';

export const STRUCTURE_LABELS: Record<BoardStructure, string> = {
  'triple-run': '三连张',
  'double-run': '两连张',
  'one-gapper': '隔一张',
  disconnected: '不连',
  'kicker-adjacent': '踢脚相邻',
  'kicker-one-gap': '踢脚隔一张',
  'kicker-far': '踢脚远离',
  trips: '三条',
};

/** 点数 -> 0..12（2 最低，A 最高）。 */
const RANK_INDEX: Record<Rank, number> = RANKS.reduce(
  (acc, rank, index) => {
    acc[rank] = index;
    return acc;
  },
  {} as Record<Rank, number>,
);

const SUIT_INDEX: Record<Suit, number> = { s: 0, h: 1, d: 2, c: 3 };

/** S4：4 种花色的全部 24 种置换。 */
const SUIT_PERMUTATIONS: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  const rec = (prefix: number[], rest: number[]): void => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    rest.forEach((value, index) => {
      rec(
        [...prefix, value],
        [...rest.slice(0, index), ...rest.slice(index + 1)],
      );
    });
  };
  rec([], [0, 1, 2, 3]);
  return out;
})();

/** 三张牌的规范形（数值键）：整体置换花色后取最小的编码。 */
function canonicalCode(
  ranks: readonly number[],
  suits: readonly number[],
  translate: boolean,
): number {
  const shift = translate ? Math.min(ranks[0], ranks[1], ranks[2]) : 0;
  const r0 = ranks[0] - shift;
  const r1 = ranks[1] - shift;
  const r2 = ranks[2] - shift;
  let best = Number.POSITIVE_INFINITY;
  for (const perm of SUIT_PERMUTATIONS) {
    let c0 = r0 * 4 + perm[suits[0]];
    let c1 = r1 * 4 + perm[suits[1]];
    let c2 = r2 * 4 + perm[suits[2]];
    // 3 个数排序后打包（每个编码 <= 51）
    if (c0 > c1) {
      const t = c0;
      c0 = c1;
      c1 = t;
    }
    if (c1 > c2) {
      const t = c1;
      c1 = c2;
      c2 = t;
    }
    if (c0 > c1) {
      const t = c0;
      c0 = c1;
      c1 = t;
    }
    const packed = c0 * 2704 + c1 * 52 + c2;
    if (packed < best) best = packed;
  }
  return best;
}

/** 只看点数的「形状」键：点数整体平移后相同算一种（0-1-2 就是最小的三连张）。 */
function rankShapeCode(ranks: readonly number[]): number {
  const shift = Math.min(ranks[0], ranks[1], ranks[2]);
  const a = ranks[0] - shift;
  const b = ranks[1] - shift;
  const c = ranks[2] - shift;
  const sorted = [a, b, c].sort((x, y) => x - y);
  return sorted[0] * 169 + sorted[1] * 13 + sorted[2];
}

export interface BoardTextureKeys {
  strategic: number;
  shape: number;
  coarse: number;
}

/** 三张牌在三个层级下的类键。 */
export function boardTextureKeys(
  cards: readonly [Card, Card, Card],
): BoardTextureKeys {
  const ranks = cards.map((card) => RANK_INDEX[card.rank]);
  const suits = cards.map((card) => SUIT_INDEX[card.suit]);
  const strategic = canonicalCode(ranks, suits, false);
  const shape = canonicalCode(ranks, suits, true);
  const suitCount = new Set(suits).size;
  return { strategic, shape, coarse: rankShapeCode(ranks) * 4 + suitCount };
}

function suitClassOf(cards: readonly Card[]): BoardSuitClass {
  const count = new Set(cards.map((card) => card.suit)).size;
  if (count === 1) return 'monotone';
  if (count === 2) return 'two-tone';
  return 'rainbow';
}

/** 点数从大到小排序（A 最大）。 */
function sortByRank(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]);
}

function pairingOfSorted(sorted: readonly Card[]): BoardPairing {
  const sameFirst = sorted[0].rank === sorted[1].rank;
  const sameLast = sorted[1].rank === sorted[2].rank;
  if (sameFirst) return sameLast ? 'trips' : 'pair';
  return sameLast ? 'pair' : 'unpaired';
}

/**
 * 连张结构。无对时把 A 同时当作低位（A2345 的算法），
 * 所以 A23 / A2K 这类牌面也能被正确描述。
 */
function structureOfSorted(
  sorted: readonly Card[],
  pairing: BoardPairing,
): BoardStructure {
  if (pairing === 'trips') return 'trips';

  const acesLow = sorted.some((card) => card.rank === 'A');
  const values = sorted.map((card) => RANK_INDEX[card.rank]);
  if (acesLow) values.push(-1);

  if (pairing === 'pair') {
    const pairRank = RANK_INDEX[sorted[0].rank];
    const kickerRank = RANK_INDEX[sorted[2].rank];
    const straightGap = Math.abs(pairRank - kickerRank);
    const cyclicGap = Math.min(straightGap, 13 - straightGap);
    if (cyclicGap === 1) return 'kicker-adjacent';
    if (cyclicGap === 2) return 'kicker-one-gap';
    return 'kicker-far';
  }

  const set = new Set(values);
  const hasRun = (length: number): boolean => {
    for (let start = -1; start + length - 1 <= 12; start += 1) {
      let ok = true;
      for (let step = 0; step < length; step += 1) {
        if (!set.has(start + step)) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  };

  if (hasRun(3)) return 'triple-run';
  if (hasRun(2)) return 'double-run';
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  for (let i = 0; i < distinct.length; i += 1) {
    for (let j = i + 1; j < distinct.length; j += 1) {
      if (distinct[j] - distinct[i] === 2) return 'one-gapper';
    }
  }
  return 'disconnected';
}

/** 同花结构（哪几张同花）+ 是否用具名点数描述。 */
type SuitNameMode = 'ranks' | 'positions';

const POSITION_NAMES = ['最高', '中间', '最低'] as const;

function suitStructureLabel(
  sorted: readonly Card[],
  pairing: BoardPairing,
  mode: SuitNameMode,
): string {
  const suitCount = new Set(sorted.map((card) => card.suit)).size;
  if (pairing === 'trips') return '三张不同花';
  if (pairing === 'pair') {
    return suitCount === 2 ? '踢脚与对子同花' : '踢脚不同花';
  }
  if (suitCount === 3) return '三张不同花';
  if (suitCount === 1) return '三张同花（单色）';

  const pairs: number[][] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[i].suit === sorted[j].suit) pairs.push([i, j]);
    }
  }
  const [a, b] = pairs[0];
  const name = (index: number) =>
    mode === 'ranks' ? sorted[index].rank : POSITION_NAMES[index];
  return `${name(a)} + ${name(b)} 同花`;
}

export interface BoardTextureDims {
  pairing: BoardPairing;
  pairingLabel: string;
  suitClass: BoardSuitClass;
  suitClassLabel: string;
  structure: BoardStructure;
  structureLabel: string;
  /** 具体同花结构（策略级用具名点数，其他层级用位置名）。 */
  suitStructureLabel: string;
  /** 点数串，例如 AKQ / AAK / AAA。 */
  rankLabel: string;
  /** 最高张，例如 A 高。 */
  highLabel: string;
  /** 精确形状：跨度 + 相邻点数的间隔（点数平移后仍然成立）。 */
  relativeLabel: string;
}

/** 无对时两张相邻点数的间隔；带对时踢脚与对子的距离。 */
function gapsOfSorted(
  sorted: readonly Card[],
  pairing: BoardPairing,
): { span: number; lowGap: number; highGap: number; kickerGap: number } {
  const a = RANK_INDEX[sorted[0].rank];
  const b = RANK_INDEX[sorted[1].rank];
  const c = RANK_INDEX[sorted[2].rank];
  const span = a - c;
  const kickerGap = pairing === 'pair' ? Math.min(a - c, 13 - (a - c)) : 0;
  return { span, lowGap: b - c, highGap: a - b, kickerGap };
}

function relativeLabelOf(
  sorted: readonly Card[],
  pairing: BoardPairing,
  gaps: { span: number; lowGap: number; highGap: number; kickerGap: number },
): string {
  if (pairing === 'trips') return '跨度 0';
  if (pairing === 'pair') {
    // 踢脚在对子之上还是之下，是两种不同形状（AKK 与 AAK）
    const above = sorted[0].rank !== sorted[1].rank;
    return above ? `踢脚高 ${gaps.span} 级` : `踢脚低 ${gaps.span} 级`;
  }
  return `跨度 ${gaps.span} · 间隔 ${gaps.lowGap} + ${gaps.highGap}`;
}

function dimsOfSorted(
  sorted: readonly Card[],
  pairing: BoardPairing,
  suitClass: BoardSuitClass,
  structure: BoardStructure,
  mode: SuitNameMode,
): BoardTextureDims {
  return {
    pairing,
    pairingLabel: PAIRING_LABELS[pairing],
    suitClass,
    suitClassLabel: SUIT_CLASS_LABELS[suitClass],
    structure,
    structureLabel: STRUCTURE_LABELS[structure],
    suitStructureLabel: suitStructureLabel(sorted, pairing, mode),
    rankLabel: sorted.map((card) => card.rank).join(''),
    highLabel: `${sorted[0].rank} 高`,
    relativeLabel: relativeLabelOf(sorted, pairing, gapsOfSorted(sorted, pairing)),
  };
}

/** 三张牌的结构描述（不含类键）。 */
export function boardTextureDims(
  cards: readonly [Card, Card, Card],
  mode: SuitNameMode = 'ranks',
): BoardTextureDims {
  const sorted = sortByRank(cards);
  const pairing = pairingOfSorted(sorted);
  const suitClass = suitClassOf(cards);
  const structure = structureOfSorted(sorted, pairing);
  return dimsOfSorted(sorted, pairing, suitClass, structure, mode);
}

/** 某一层级下这一类的名字。 */
export function boardTextureLabel(
  level: BoardTextureLevel,
  sorted: readonly Card[],
  dims: BoardTextureDims,
): string {
  if (level === 'coarse') {
    return `${dims.pairingLabel} · ${dims.structureLabel}（${dims.relativeLabel}） · ${dims.suitClassLabel}`;
  }
  if (level === 'shape') {
    return `${dims.pairingLabel} · ${dims.structureLabel}（${dims.relativeLabel}） · ${dims.suitStructureLabel}`;
  }
  return `${dims.rankLabel} · ${dims.suitStructureLabel} · ${dims.structureLabel}`;
}

/** 分组标题。 */
function sectionLabelOf(
  level: BoardTextureLevel,
  dims: BoardTextureDims,
): string {
  if (level === 'coarse') {
    return `${dims.pairingLabel} · ${dims.structureLabel}`;
  }
  if (level === 'shape') {
    return `${dims.pairingLabel} · ${dims.suitClassLabel}`;
  }
  return `${dims.pairingLabel} · ${dims.suitClassLabel} · ${dims.structureLabel}`;
}

export interface BoardTextureRow {
  level: BoardTextureLevel;
  key: number;
  label: string;
  sectionLabel: string;
  pairing: BoardPairing;
  suitClass: BoardSuitClass;
  structure: BoardStructure;
  /** 这一类包含多少种具体翻牌。 */
  count: number;
  probability: number;
  example: readonly [Card, Card, Card];
  exampleLabel: string;
  rankLabel: string;
  highLabel: string;
}

export interface BoardTextureSection {
  label: string;
  rows: BoardTextureRow[];
  count: number;
  classCount: number;
  probability: number;
}

export interface BoardTextureLevelView {
  level: BoardTextureLevel;
  label: string;
  hint: string;
  classCount: number;
  /** 平均每一类包含多少种具体翻牌。 */
  averageSize: number;
  rows: BoardTextureRow[];
  sections: BoardTextureSection[];
  byKey: Map<number, BoardTextureRow>;
}

export interface BoardTextureTotal<T extends string> {
  value: T;
  label: string;
  count: number;
  probability: number;
}

export interface BoardTextureAtlas {
  totalFlops: number;
  levels: Record<BoardTextureLevel, BoardTextureLevelView>;
  pairingTotals: BoardTextureTotal<BoardPairing>[];
  suitTotals: BoardTextureTotal<BoardSuitClass>[];
}

interface Bucket {
  count: number;
  score: number;
  cards: [Card, Card, Card];
}

function collect(
  map: Map<number, Bucket>,
  key: number,
  cards: readonly [Card, Card, Card],
  score: number,
): void {
  const hit = map.get(key);
  if (hit === undefined) {
    map.set(key, { count: 1, score, cards: [cards[0], cards[1], cards[2]] });
    return;
  }
  hit.count += 1;
  if (score > hit.score) {
    hit.score = score;
    hit.cards = [cards[0], cards[1], cards[2]];
  }
}

function buildRows(
  level: BoardTextureLevel,
  buckets: Map<number, Bucket>,
  totalFlops: number,
): BoardTextureRow[] {
  const mode: SuitNameMode = level === 'strategic' ? 'ranks' : 'positions';
  const rows: BoardTextureRow[] = [];
  for (const [key, bucket] of buckets) {
    const sorted = sortByRank(bucket.cards);
    const dims = boardTextureDims(bucket.cards, mode);
    const label = boardTextureLabel(level, sorted, dims);
    rows.push({
      level,
      key,
      label,
      sectionLabel: sectionLabelOf(level, dims),
      pairing: dims.pairing,
      suitClass: dims.suitClass,
      structure: dims.structure,
      count: bucket.count,
      probability: bucket.count / totalFlops,
      example: bucket.cards,
      exampleLabel: sorted.map(cardToString).join(' '),
      rankLabel: dims.rankLabel,
      highLabel: dims.highLabel,
    });
  }
  rows.sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN'),
  );
  return rows;
}

function buildSections(
  rows: readonly BoardTextureRow[],
  totalFlops: number,
): BoardTextureSection[] {
  const map = new Map<string, BoardTextureRow[]>();
  for (const row of rows) {
    const list = map.get(row.sectionLabel);
    if (list) list.push(row);
    else map.set(row.sectionLabel, [row]);
  }
  const sections: BoardTextureSection[] = [];
  for (const [label, list] of map) {
    const count = list.reduce((sum, row) => sum + row.count, 0);
    sections.push({
      label,
      rows: list,
      count,
      classCount: list.length,
      probability: count / totalFlops,
    });
  }
  sections.sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN'),
  );
  return sections;
}

/**
 * 枚举全部 22,100 种翻牌，一次性得出三个层级的归类。
 * 22,100 × 24 次置换 ≈ 几十毫秒，所以页面可以同步算完，不需要进度条。
 */
export function buildBoardTextureAtlas(): BoardTextureAtlas {
  const deck = createDeck();
  const strategic = new Map<number, Bucket>();
  const shape = new Map<number, Bucket>();
  const coarse = new Map<number, Bucket>();
  const pairingCount = new Map<BoardPairing, number>();
  const suitCount = new Map<BoardSuitClass, number>();

  let totalFlops = 0;
  for (let i = 0; i < 52; i += 1) {
    for (let j = i + 1; j < 52; j += 1) {
      for (let k = j + 1; k < 52; k += 1) {
        const cards: [Card, Card, Card] = [deck[i], deck[j], deck[k]];
        const keys = boardTextureKeys(cards);
        const score =
          RANK_VALUES[cards[0].rank] +
          RANK_VALUES[cards[1].rank] +
          RANK_VALUES[cards[2].rank];
        collect(strategic, keys.strategic, cards, score);
        collect(shape, keys.shape, cards, score);
        collect(coarse, keys.coarse, cards, score);

        const sorted = sortByRank(cards);
        const pairing = pairingOfSorted(sorted);
        const suitClass = suitClassOf(cards);
        pairingCount.set(pairing, (pairingCount.get(pairing) ?? 0) + 1);
        suitCount.set(suitClass, (suitCount.get(suitClass) ?? 0) + 1);
        totalFlops += 1;
      }
    }
  }

  const buildLevel = (level: BoardTextureLevel): BoardTextureLevelView => {
    const buckets =
      level === 'strategic' ? strategic : level === 'shape' ? shape : coarse;
    const rows = buildRows(level, buckets, totalFlops);
    return {
      level,
      label: BOARD_TEXTURE_LEVEL_LABELS[level],
      hint: BOARD_TEXTURE_LEVEL_HINTS[level],
      classCount: rows.length,
      averageSize: totalFlops / rows.length,
      rows,
      sections: buildSections(rows, totalFlops),
      byKey: new Map(rows.map((row) => [row.key, row])),
    };
  };

  return {
    totalFlops,
    levels: {
      strategic: buildLevel('strategic'),
      shape: buildLevel('shape'),
      coarse: buildLevel('coarse'),
    },
    pairingTotals: PAIRING_ORDER.map((pairing) => {
      const count = pairingCount.get(pairing) ?? 0;
      return {
        value: pairing,
        label: PAIRING_LABELS[pairing],
        count,
        probability: count / totalFlops,
      };
    }),
    suitTotals: SUIT_CLASS_ORDER.map((suitClass) => {
      const count = suitCount.get(suitClass) ?? 0;
      return {
        value: suitClass,
        label: SUIT_CLASS_LABELS[suitClass],
        count,
        probability: count / totalFlops,
      };
    }),
  };
}

export interface BoardLookupEntry {
  level: BoardTextureLevel;
  levelLabel: string;
  label: string;
  count: number;
  probability: number;
}

export interface BoardLookup {
  cards: readonly [Card, Card, Card];
  /** 一句话结构描述：无对 · 两色 · 三连张 */
  summary: string;
  pairingLabel: string;
  suitClassLabel: string;
  structureLabel: string;
  rankLabel: string;
  highLabel: string;
  entries: BoardLookupEntry[];
}

function toTriple(cards: readonly Card[]): [Card, Card, Card] {
  if (cards.length !== 3) {
    throw new Error(`牌面结构需要正好 3 张牌，当前 ${cards.length} 张`);
  }
  const keys = new Set(cards.map((card) => `${card.rank}${card.suit}`));
  if (keys.size !== 3) throw new Error('3 张牌里有重复的牌');
  return [cards[0], cards[1], cards[2]];
}

/** 给定 3 张牌，返回它在三个层级里的类别与概率。 */
export function lookupBoard(
  atlas: BoardTextureAtlas,
  cards: readonly Card[],
): BoardLookup {
  const triple = toTriple(cards);
  const keys = boardTextureKeys(triple);
  const dims = boardTextureDims(triple);
  const entries = BOARD_TEXTURE_LEVELS.map((level) => {
    const row = atlas.levels[level].byKey.get(keys[level]);
    if (!row) {
      throw new Error(`牌面结构枚举里找不到这一类（${level}）`);
    }
    return {
      level,
      levelLabel: BOARD_TEXTURE_LEVEL_LABELS[level],
      label: row.label,
      count: row.count,
      probability: row.probability,
    };
  });
  return {
    cards: triple,
    summary: `${dims.pairingLabel} · ${dims.suitClassLabel} · ${dims.structureLabel}`,
    pairingLabel: dims.pairingLabel,
    suitClassLabel: dims.suitClassLabel,
    structureLabel: dims.structureLabel,
    rankLabel: dims.rankLabel,
    highLabel: dims.highLabel,
    entries,
  };
}
