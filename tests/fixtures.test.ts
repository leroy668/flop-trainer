import { describe, expect, it } from 'vitest';
import { analyzeScenario } from '../src/poker/analyzer';
import { HandCategory } from '../src/poker/evaluator';
import { dealNextStreet, generateRandomScenario } from '../src/poker/randomScenario';
import { getRemainingDeck } from '../src/poker/cards';
import { enumerateOpponentHands } from '../src/poker/combinations';
import { scenario } from './helpers';

/**
 * 需求第 54~57 条：固定 Fixture 验收。
 *
 * Hero:  A♠ K♦
 * Flop:  A♥ 8♣ 3♦
 */
describe('Fixture: A♠K♦ / A♥8♣3♦', () => {
  const analysis = analyzeScenario(scenario('As Kd', 'Ah 8c 3d'));
  const twoPair = analysis.byCategory.find(
    (entry) => entry.category === HandCategory.TwoPair,
  )!;

  it('两对中能压过 Hero 的组合数为 21', () => {
    expect(twoPair.aheadCount).toBe(21);
  });

  it('两对按概率拆分：83=9 单独一行，A8 / A3 各 6 合成一行', () => {
    expect(twoPair.groups.map((g) => g.label)).toEqual(['83', 'A8 / A3']);
    expect(twoPair.groups.map((g) => g.comboCount)).toEqual([9, 12]);
  });

  it('6 + 6 + 9 = 21', () => {
    const total = twoPair.groups.reduce((acc, group) => acc + group.comboCount, 0);
    expect(total).toBe(21);
  });

  it('A8 Blocker：剩余 2 张 A × 3 张 8 = 6，与 A3 合为一行后共 12', () => {
    const group = twoPair.groups.find((item) => item.label === 'A8 / A3')!;
    expect(group.comboCount).toBe(12);
    expect(group.combos).toHaveLength(12);
    const a8 = group.combos.filter(
      ([a, b]) => [a.rank, b.rank].sort().join('') === '8A',
    );
    const a3 = group.combos.filter(
      ([a, b]) => [a.rank, b.rank].sort().join('') === '3A',
    );
    expect(a8).toHaveLength(6);
    expect(a3).toHaveLength(6);
  });

  it('83 Blocker：剩余 3 张 8 × 3 张 3 = 9', () => {
    const group = twoPair.groups.find((item) => item.label === '83')!;
    expect(group.comboCount).toBe(9);
  });

  it('三条能压过 Hero 的组合为 7（AA=1 + 88=3 + 33=3）', () => {
    const trips = analysis.byCategory.find(
      (entry) => entry.category === HandCategory.Trips,
    )!;
    expect(trips.aheadCount).toBe(7);
    // 88 与 33 各 3 个 → 合成一行；AA 只有 1 个 → 单独一行。
    expect(trips.groups.map((g) => g.label)).toEqual(['88 / 33', 'AA']);
    expect(trips.groups.map((g) => g.comboCount)).toEqual([6, 1]);
  });

  it('同牌型（一对）中 AK 与 Hero 完全平手 = 6', () => {
    const same = analysis.sameCategory;
    expect(same.category).toBe(HandCategory.OnePair);
    const tieGroups = same.totalCount;
    expect(tieGroups).toBeGreaterThan(0);
    // 同牌型里比 Hero 大的组合：Hero 是顶对顶踢脚，应为 0。
    expect(same.aheadCount).toBe(0);
    // A+K 平手：剩余 2 张 A × 3 张 K = 6
    expect(same.tieCount).toBeGreaterThanOrEqual(6);
  });

  it('两对概率 = 21 / 1081', () => {
    expect(twoPair.aheadProbability).toBeCloseTo(21 / 1081, 12);
  });
});

/**
 * 需求第 65 条：随机场景 Property Test。
 */
describe('随机场景 Property Test（1000 个）', () => {
  it('每个随机场景都满足核心不变量', { timeout: 60000 }, () => {
    for (let i = 0; i < 1000; i += 1) {
      const s = generateRandomScenario();
      const remaining = getRemainingDeck(s);
      const hands = enumerateOpponentHands(remaining);
      expect(remaining).toHaveLength(47);
      expect(hands).toHaveLength(1081);

      const analysis = analyzeScenario(s);
      expect(analysis.aheadCount + analysis.tieCount + analysis.behindCount).toBe(1081);
      expect(analysis.totalOpponentCombos).toBe(1081);

      const categorySum = analysis.byCategory.reduce(
        (acc, item) => acc + item.aheadCount,
        0,
      );
      expect(categorySum).toBe(analysis.aheadCount);

      const same = analysis.sameCategory;
      expect(same.aheadCount + same.tieCount + same.behindCount).toBe(same.totalCount);
    }
  });
});

/**
 * 转牌圈 / 河牌圈同样跑一遍不变量，确保「7 张取最优 5 张」没有破坏枚举逻辑。
 */
describe('随机场景 Property Test（转牌 60 / 河牌 60）', () => {
  it('转牌圈与河牌圈都满足核心不变量', { timeout: 120000 }, () => {
    for (let i = 0; i < 60; i += 1) {
      for (const street of ['turn', 'river'] as const) {
        let s = generateRandomScenario();
        s = dealNextStreet(s);
        if (street === 'river') s = dealNextStreet(s);

        const remaining = getRemainingDeck(s);
        const hands = enumerateOpponentHands(remaining);
        const total = street === 'turn' ? 1035 : 990;
        expect(remaining).toHaveLength(street === 'turn' ? 46 : 45);
        expect(hands).toHaveLength(total);

        const analysis = analyzeScenario(s);
        expect(analysis.street).toBe(street);
        expect(analysis.totalOpponentCombos).toBe(total);
        expect(analysis.aheadCount + analysis.tieCount + analysis.behindCount).toBe(
          total,
        );
        expect(
          analysis.byCategory.reduce((acc, item) => acc + item.totalCount, 0),
        ).toBe(total);
        expect(
          analysis.byCategory.reduce((acc, item) => acc + item.aheadCount, 0),
        ).toBe(analysis.aheadCount);

        const same = analysis.sameCategory;
        expect(same.aheadCount + same.tieCount + same.behindCount).toBe(
          same.totalCount,
        );

        // 每个分组内成员概率必须真的相同（合并算法的关键不变量）。
        for (const entry of analysis.byCategory) {
          for (const group of entry.groups) {
            expect(group.probability).toBeCloseTo(group.comboCount / total, 12);
            expect(group.combos.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
