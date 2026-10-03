/** 忽略花色后的点数类型聚合（A8 / 88 / KQ ...）。 */

import type { Card } from './cards';
import { RANK_VALUES } from './cards';
import { rankValueToLabel } from './evaluator';
import type { HoleCards } from './combinations';

/**
 * 返回忽略花色的点数标签，高点数在前。
 *
 * A♠ 8♦ -> "A8"
 * 8♦ A♠ -> "A8"
 * 8♠ 8♥ -> "88"
 */
export function getRankGroup(holeCards: HoleCards): string {
  const [a, b] = holeCards;
  const av = RANK_VALUES[a.rank];
  const bv = RANK_VALUES[b.rank];
  const high = av >= bv ? av : bv;
  const low = av >= bv ? bv : av;
  return `${rankValueToLabel(high)}${rankValueToLabel(low)}`;
}

/** 用于稳定排序的辅助：等级越高越靠前，对子优先。 */
export function rankGroupSortValue(label: string): number {
  const first = label[0];
  const second = label[1];
  const high = RANK_VALUES[first as keyof typeof RANK_VALUES] ?? 0;
  const low = RANK_VALUES[second as keyof typeof RANK_VALUES] ?? 0;
  const isPair = first === second ? 1 : 0;
  return high * 100 + low * 2 + isPair;
}

export function sortCardsDesc(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const diff = RANK_VALUES[b.rank] - RANK_VALUES[a.rank];
    if (diff !== 0) return diff;
    return a.suit.localeCompare(b.suit);
  });
}
