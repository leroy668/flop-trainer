/** 同类别 / 跨类别牌力比较。 */

import type { HandValue } from './evaluator';

export type CompareResult = -1 | 0 | 1;

/**
 * 比较两手牌。
 *  1 = a 更大
 *  0 = 完全平手
 * -1 = a 更小
 */
export function compareHandValues(a: HandValue, b: HandValue): CompareResult {
  if (a.category !== b.category) {
    return a.category > b.category ? 1 : -1;
  }
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i += 1) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}
