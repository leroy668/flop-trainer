/** 概率区间定义与判定。 */

import type { ProbabilityRange } from './types';

/**
 * 区间规则为 [min, max)：
 * 一个概率只会落在一个区间里。
 * 最后一个区间包含 100%。
 *
 * 共 5 档：在低概率段保留 1% / 3% 两个关键边界，
 * 高概率段适当合并，减少作答时的选项数量。
 */
export const PROBABILITY_RANGES: readonly ProbabilityRange[] = [
  { id: '0-1', min: 0, max: 0.01, label: '0～1%' },
  { id: '1-3', min: 0.01, max: 0.03, label: '1～3%' },
  { id: '3-10', min: 0.03, max: 0.1, label: '3～10%' },
  { id: '10-35', min: 0.1, max: 0.35, label: '10～35%' },
  { id: '35-100', min: 0.35, max: 1.000001, label: '35～100%' },
];

export function getProbabilityRange(probability: number): ProbabilityRange {
  const clamped = Math.min(Math.max(probability, 0), 1);
  for (const range of PROBABILITY_RANGES) {
    if (clamped >= range.min && clamped < range.max) {
      return range;
    }
  }
  // 理论上不可达；最后一个区间包含 100%。
  return PROBABILITY_RANGES[PROBABILITY_RANGES.length - 1];
}

export function getProbabilityRangeById(id: string): ProbabilityRange | undefined {
  return PROBABILITY_RANGES.find((range) => range.id === id);
}

/** 格式化概率为百分比字符串，默认 2 位小数。 */
export function formatPercent(probability: number, digits = 2): string {
  return `${(probability * 100).toFixed(digits)}%`;
}

/** 格式化“x / y”形式的组合占比。 */
export function formatRatio(
  count: number,
  total: number,
  digits = 2,
): string {
  if (total <= 0) return '—';
  return `${count} / ${total}（${formatPercent(count / total, digits)}）`;
}
