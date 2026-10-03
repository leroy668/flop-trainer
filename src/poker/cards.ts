/**
 * 基础牌数据结构与牌堆操作。
 *
 * 该文件不依赖任何 UI / React 代码，保证扑克数学逻辑与显示层分离。
 */

export type Rank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'T'
  | 'J'
  | 'Q'
  | 'K'
  | 'A';

export type Suit = 's' | 'h' | 'd' | 'c';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const RANKS: readonly Rank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
  'A',
];

export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];

/** 点数 -> 数值。T=10, J=11, Q=12, K=13, A=14。 */
export const RANK_VALUES: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

export function isRedSuit(suit: Suit): boolean {
  return suit === 'h' || suit === 'd';
}

export function rankValue(rank: Rank): number {
  return RANK_VALUES[rank];
}

/** 生成一副 52 张唯一扑克牌。 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/** 稳定、唯一的牌 ID，例如 A♠ -> "As"。 */
export function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

/** 用于展示的字符串，例如 A♠。 */
export function cardToString(card: Card): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

export function isSameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

/**
 * 从字符串解析牌，支持 "As" / "A♠" / "10s" 等写法。
 * 主要用于调试页输入。
 */
export function parseCard(input: string): Card {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('空字符串无法解析为扑克牌');

  const suitChar = trimmed.slice(-1).toLowerCase();
  const suitAlias: Record<string, Suit> = {
    s: 's',
    '♠': 's',
    h: 'h',
    '♥': 'h',
    d: 'd',
    '♦': 'd',
    c: 'c',
    '♣': 'c',
  };
  const suit = suitAlias[suitChar];
  if (!suit) throw new Error(`无法识别的花色：${trimmed}`);

  let rankPart = trimmed.slice(0, -1).toUpperCase();
  if (rankPart === '10') rankPart = 'T';
  if (!RANKS.includes(rankPart as Rank)) {
    throw new Error(`无法识别的点数：${trimmed}`);
  }
  return { rank: rankPart as Rank, suit };
}

/** 用于调试页的 "As Kd" 形式解析。 */
export function parseCards(input: string): Card[] {
  return input
    .split(/[\s,，]+/)
    .filter(Boolean)
    .map(parseCard);
}

export interface Scenario {
  hero: [Card, Card];
  flop: [Card, Card, Card];
  /** 转牌，发出后才有。 */
  turn?: Card;
  /** 河牌，发出后才有。 */
  river?: Card;
}

/** 当前处于哪一条街。 */
export type Street = 'flop' | 'turn' | 'river';

export const STREET_LABELS: Record<Street, string> = {
  flop: '翻牌圈',
  turn: '转牌圈',
  river: '河牌圈',
};

/** 单张牌的说法，用在「收回转牌」「发河牌」这类动作上。 */
export const STREET_CARD_LABELS: Record<Street, string> = {
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
};

/** 公共牌：翻牌 3 张 + 已发出的转牌 / 河牌。 */
export function boardCards(scenario: Scenario): Card[] {
  const board = [...scenario.flop];
  if (scenario.turn) board.push(scenario.turn);
  if (scenario.river) board.push(scenario.river);
  return board;
}

/** Hero 两张底牌 + 全部公共牌，即已知的 5 / 6 / 7 张牌。 */
export function knownCards(scenario: Scenario): Card[] {
  return [...scenario.hero, ...boardCards(scenario)];
}

/** 按发牌进度判断当前处于哪条街。 */
export function streetOf(scenario: Scenario): Street {
  if (scenario.river) return 'river';
  if (scenario.turn) return 'turn';
  return 'flop';
}

/** 还要发几张公共牌（翻牌后 2 张、转牌后 1 张、河牌后 0 张）。 */
export function remainingBoardCards(scenario: Scenario): number {
  return 5 - boardCards(scenario).length;
}

/** 校验场景：2 张底牌 + 3~5 张公共牌，且互不重复。 */
export function validateScenario(scenario: Scenario): void {
  const cards = knownCards(scenario);
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(
      `场景需要 2 张底牌 + 3~5 张公共牌（共 5~7 张），当前为 ${cards.length} 张`,
    );
  }
  const seen = new Set<string>();
  for (const card of cards) {
    const key = cardKey(card);
    if (seen.has(key)) {
      throw new Error(`场景中存在重复牌：${cardToString(card)}`);
    }
    seen.add(key);
  }
}

/** 从 52 张牌中移除已知牌，返回剩余的 47 / 46 / 45 张。 */
export function getRemainingDeck(scenario: Scenario): Card[] {
  validateScenario(scenario);
  const used = new Set<string>(knownCards(scenario).map(cardKey));
  return createDeck().filter((card) => !used.has(cardKey(card)));
}

export function scenarioToKey(scenario: Scenario): string {
  return knownCards(scenario).map(cardKey).join('');
}
