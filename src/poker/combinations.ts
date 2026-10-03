/** 对手底牌组合枚举。 */

import type { Card } from './cards';

export type HoleCards = [Card, Card];

/** C(n, 2)，即从 n 张牌里取 2 张的组合数。 */
export function pairCount(n: number): number {
  return n < 2 ? 0 : (n * (n - 1)) / 2;
}

/**
 * 枚举 remainingDeck 中所有不同的两张牌组合。
 * AB 与 BA 视为同一组合，因此结果数量为 C(n, 2)。
 */
export function enumerateOpponentHands(
  remainingDeck: readonly Card[],
): HoleCards[] {
  const hands: HoleCards[] = [];
  for (let i = 0; i < remainingDeck.length; i += 1) {
    for (let j = i + 1; j < remainingDeck.length; j += 1) {
      hands.push([remainingDeck[i], remainingDeck[j]]);
    }
  }
  return hands;
}
