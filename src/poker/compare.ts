/** 同类别 / 跨类别牌力比较。 */

import { compareHandValue } from './evaluator';
import type { HandValue } from './evaluator';

export type CompareResult = -1 | 0 | 1;

/**
 * 比较两手牌。
 *  1 = a 更大
 *  0 = 完全平手
 * -1 = a 更小
 *
 * 实现放在 evaluator.ts（evaluateBestHand 取最大值时也要用），这里只是对外入口。
 */
export function compareHandValues(a: HandValue, b: HandValue): CompareResult {
  return compareHandValue(a, b);
}
