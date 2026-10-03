import { describe, expect, it } from 'vitest';
import {
  PROBABILITY_RANGES,
  getProbabilityRange,
} from '../src/trainer/ranges';

describe('概率区间边界 [min, max)', () => {
  const cases: Array<[number, string]> = [
    [0, '0-1'],
    [0.005, '0-1'],
    [0.01, '1-3'],
    [0.029, '1-3'],
    [0.03, '3-10'],
    [0.07, '3-10'],
    [0.1, '10-35'],
    [0.2, '10-35'],
    [0.35, '35-100'],
    [0.6, '35-100'],
    [1, '35-100'],
  ];

  it('共有 5 档', () => {
    expect(PROBABILITY_RANGES).toHaveLength(5);
  });

  for (const [probability, expected] of cases) {
    it(`${probability} -> ${expected}`, () => {
      expect(getProbabilityRange(probability).id).toBe(expected);
    });
  }

  it('区间互不重叠且覆盖 [0, 1]', () => {
    for (let i = 0; i <= 1000; i += 1) {
      const p = i / 1000;
      const matches = PROBABILITY_RANGES.filter(
        (range) => p >= range.min && p < range.max,
      );
      expect(matches).toHaveLength(1);
    }
  });

  it('每个区间内部取值都落回自身', () => {
    for (const range of PROBABILITY_RANGES) {
      const mid = (range.min + Math.min(range.max, 1)) / 2;
      const clamped = Math.min(mid, 1);
      expect(getProbabilityRange(clamped).id).toBe(range.id);
    }
  });
});
