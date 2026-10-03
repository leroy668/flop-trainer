/**
 * 五张牌牌力评价。
 *
 * 翻牌圈一共只有 5 张牌（2 张底牌 + 3 张公共牌），
 * 因此第一版精确评价这 5 张牌，不做“7 选 5”。
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
