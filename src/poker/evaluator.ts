/**
 * 五张牌牌力评价。
 *
 * 翻牌圈只有 5 张牌（2 张底牌 + 3 张公共牌），直接评价；
 * 转牌（6 张）与河牌（7 张）则是在 C(6,5)=6 / C(7,5)=21 个五张组合里取最大，
 * 即 evaluateBestHand。
 */

import type { Card, Rank } from './cards';
import { RANK_VALUES } from './cards';

export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const HAND_CATEGORY_LABELS: Record<HandCategory, string> = {
  [HandCategory.HighCard]: '高牌',
  [HandCategory.OnePair]: '一对',
  [HandCategory.TwoPair]: '两对',
  [HandCategory.Trips]: '三条',
  [HandCategory.Straight]: '顺子',
  [HandCategory.Flush]: '同花',
  [HandCategory.FullHouse]: '葫芦',
  [HandCategory.Quads]: '四条',
  [HandCategory.StraightFlush]: '同花顺',
};

export const ALL_HAND_CATEGORIES: readonly HandCategory[] = [
  HandCategory.HighCard,
  HandCategory.OnePair,
  HandCategory.TwoPair,
  HandCategory.Trips,
  HandCategory.Straight,
  HandCategory.Flush,
  HandCategory.FullHouse,
  HandCategory.Quads,
  HandCategory.StraightFlush,
];

/**
 * 训练中需要判断的牌型：排除最低的「高牌」。
 *
 * 高牌只是比较单张大小，不属于成牌，
 * 因此不要求作答，也不参与评分（结果页仍会展示其精确数字作为参考）。
 */
export const TRAINABLE_HAND_CATEGORIES: readonly HandCategory[] =
  ALL_HAND_CATEGORIES.filter(
    (category) => category !== HandCategory.HighCard,
  );

export function isTrainableCategory(category: HandCategory): boolean {
  return category !== HandCategory.HighCard;
}

export interface HandValue {
  category: HandCategory;
  /**
   * 同类别内部比较用的数值，从重要到次要排列。
   *
   * 例：AAK83 -> OnePair, [14, 13, 8, 3]
   *     A2345 -> Straight, [5]
   */
  tiebreak: number[];
}

interface RankCount {
  rank: Rank;
  value: number;
  count: number;
}

function countRanks(cards: readonly Card[]): RankCount[] {
  const map = new Map<Rank, number>();
  for (const card of cards) {
    map.set(card.rank, (map.get(card.rank) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([rank, count]) => ({ rank, value: RANK_VALUES[rank], count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.value - a.value;
    });
}

/**
 * 判断是否为顺子，返回顺子最高牌数值；否则返回 null。
 * A2345 记为 5 高顺子。
 */
function straightHigh(values: readonly number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length !== 5) return null;

  const max = unique[4];
  const min = unique[0];

  if (max - min === 4) return max;

  // A2345 轮子顺：14, 2, 3, 4, 5
  if (
    max === 14 &&
    unique[0] === 2 &&
    unique[1] === 3 &&
    unique[2] === 4 &&
    unique[3] === 5
  ) {
    return 5;
  }
  return null;
}

/**
 * 评价恰好 5 张牌。
 * @throws 若 cards.length !== 5
 */
export function evaluateFiveCards(cards: readonly Card[]): HandValue {
  if (cards.length !== 5) {
    throw new Error(`evaluateFiveCards 需要恰好 5 张牌，当前为 ${cards.length} 张`);
  }

  const values = cards.map((card) => RANK_VALUES[card.rank]).sort((a, b) => b - a);
  const counts = countRanks(cards);
  const isFlush = cards.every((card) => card.suit === cards[0].suit);
  const sHigh = straightHigh(values);

  if (isFlush && sHigh !== null) {
    return { category: HandCategory.StraightFlush, tiebreak: [sHigh] };
  }

  if (counts[0].count === 4) {
    return {
      category: HandCategory.Quads,
      tiebreak: [counts[0].value, counts[1].value],
    };
  }

  if (counts[0].count === 3 && counts[1]?.count === 2) {
    return {
      category: HandCategory.FullHouse,
      tiebreak: [counts[0].value, counts[1].value],
    };
  }

  if (isFlush) {
    return { category: HandCategory.Flush, tiebreak: values };
  }

  if (sHigh !== null) {
    return { category: HandCategory.Straight, tiebreak: [sHigh] };
  }

  if (counts[0].count === 3) {
    const kickers = counts
      .filter((entry) => entry.count === 1)
      .map((entry) => entry.value)
      .sort((a, b) => b - a);
    return {
      category: HandCategory.Trips,
      tiebreak: [counts[0].value, ...kickers],
    };
  }

  if (counts[0].count === 2 && counts[1]?.count === 2) {
    const pairs = counts
      .filter((entry) => entry.count === 2)
      .map((entry) => entry.value)
      .sort((a, b) => b - a);
    const kicker = counts.find((entry) => entry.count === 1)?.value ?? 0;
    return { category: HandCategory.TwoPair, tiebreak: [...pairs, kicker] };
  }

  if (counts[0].count === 2) {
    const kickers = counts
      .filter((entry) => entry.count === 1)
      .map((entry) => entry.value)
      .sort((a, b) => b - a);
    return {
      category: HandCategory.OnePair,
      tiebreak: [counts[0].value, ...kickers],
    };
  }

  return { category: HandCategory.HighCard, tiebreak: values };
}

export type HandValueComparison = -1 | 0 | 1;

/**
 * 比较两副牌的牌力：
 *  1 = a 更大，0 = 完全平手，-1 = a 更小。
 * 先比牌型，再逐位比较 tiebreak。
 */
export function compareHandValue(
  a: HandValue,
  b: HandValue,
): HandValueComparison {
  if (a.category !== b.category) return a.category > b.category ? 1 : -1;
  const length = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < length; i += 1) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

/**
 * 评价 5~7 张牌里最强的 5 张。
 *
 * 转牌 / 河牌时牌力只可能随公共牌单调增强，所以「6 / 7 张里取最优五张」
 * 与真实牌力完全一致：枚举所有五张子集（6 或 21 个）逐一评价取最大。
 * 5 张时直接评价，不走组合枚举。
 *
 * @throws 若 cards.length 不在 5~7 之间
 */
export function evaluateBestHand(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(
      `evaluateBestHand 需要 5~7 张牌，当前为 ${cards.length} 张`,
    );
  }
  if (cards.length === 5) return evaluateFiveCards(cards);

  const current: Card[] = [];
  // 先用前 5 张做初值，再枚举其余子集取最大（6~7 张牌重复评价一次，代价可忽略）。
  let best: HandValue = evaluateFiveCards(cards.slice(0, 5));

  const walk = (start: number): void => {
    if (current.length === 5) {
      const value = evaluateFiveCards(current);
      if (compareHandValue(value, best) > 0) best = value;
      return;
    }
    for (let i = start; i < cards.length; i += 1) {
      current.push(cards[i]);
      walk(i + 1);
      current.pop();
    }
  };
  walk(0);

  return best;
}

const RANK_NAMES: Record<number, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

export function rankValueToLabel(value: number): string {
  return RANK_NAMES[value] ?? String(value);
}

/** 生成中文牌型描述，例如“一对A，K踢脚”。 */
export function describeHandValue(value: HandValue): string {
  const label = HAND_CATEGORY_LABELS[value.category];
  const t = value.tiebreak;
  const card = (v: number) => rankValueToLabel(v);

  switch (value.category) {
    case HandCategory.HighCard:
      return `${label}${t.map(card).join('')}`;
    case HandCategory.OnePair:
      return `${label}${card(t[0])}，${t.slice(1).map(card).join('')}踢脚`;
    case HandCategory.TwoPair:
      return `${label}${card(t[0])}${card(t[1])}，${card(t[2])}踢脚`;
    case HandCategory.Trips:
      return `${label}${card(t[0])}，${t.slice(1).map(card).join('')}踢脚`;
    case HandCategory.Straight:
      return `${label}，${card(t[0])}高`;
    case HandCategory.Flush:
      return `${label}，${t.map(card).join('')}`;
    case HandCategory.FullHouse:
      return `${label}，${card(t[0])}带${card(t[1])}`;
    case HandCategory.Quads:
      return `${label}${card(t[0])}，${card(t[1])}踢脚`;
    case HandCategory.StraightFlush:
      return `${label}，${card(t[0])}高`;
    default:
      return label;
  }
}
