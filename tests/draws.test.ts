import { describe, expect, it } from 'vitest';
import type { Card, FlopScenario, Suit } from '../src/poker/cards';
import { cardKey, getRemainingDeck, RANK_VALUES } from '../src/poker/cards';
import {
  analyzeDraws,
  analyzeHeroDraws,
  analyzeOpponentDraws,
} from '../src/poker/draws';
import type { HeroDrawRow } from '../src/poker/draws';
import { HandCategory } from '../src/poker/evaluator';
import { generateRandomFlopScenario } from '../src/poker/randomScenario';
import { scenario } from './helpers';

const TOTAL = 1081;
const OPPONENT_RIVER_TOTAL = 990;

// ---------------------------------------------------------------------------
// 独立实现的朴素判断（不依赖 draws.ts 的掩码 / 计数逻辑），用于交叉验证。
// ---------------------------------------------------------------------------

function naiveHasFlush(cards: readonly Card[]): boolean {
  const counts = new Map<Suit, number>();
  for (const card of cards) {
    counts.set(card.suit, (counts.get(card.suit) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 5);
}

function naiveHasStraight(cards: readonly Card[]): boolean {
  const values = [...new Set(cards.map((card) => RANK_VALUES[card.rank]))].sort(
    (a, b) => a - b,
  );
  if (values.includes(14)) values.unshift(1);
  let run = 1;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] === values[i - 1] + 1) {
      run += 1;
      if (run >= 5) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

/** 穷举 Hero 的转牌与「转牌 + 河牌」组合，统计补成次数。 */
function bruteForceHero(
  flopScenario: FlopScenario,
  target: 'flush' | 'straight',
): { turnCount: number; riverCount: number; outs: number } {
  const base = [...flopScenario.hero, ...flopScenario.flop];
  const pool = getRemainingDeck(flopScenario);
  const has = target === 'flush' ? naiveHasFlush : naiveHasStraight;
  let turnCount = 0;
  for (const card of pool) {
    if (has([...base, card])) turnCount += 1;
  }
  let riverCount = 0;
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      if (has([...base, pool[i], pool[j]])) riverCount += 1;
    }
  }
  return { turnCount, riverCount, outs: turnCount };
}

function rowFor(
  rows: readonly HeroDrawRow[],
  target: HandCategory.Flush | HandCategory.Straight,
): HeroDrawRow {
  const row = rows.find((item) => item.target === target);
  if (!row) throw new Error(`没有找到 ${target} 听牌行`);
  return row;
}

describe('Hero 听牌：经典场景的精确数字', () => {
  it('同花听牌 9 张补牌：转牌 9/47，到河牌 378/1081', () => {
    const analysis = analyzeHeroDraws(scenario('As Ks', 'Qs 7s 2h'));
    const flushRow = rowFor(analysis.rows, HandCategory.Flush);

    expect(flushRow.backdoor).toBe(false);
    expect(flushRow.kind).toBe('flush');
    expect(flushRow.label).toBe('同花听牌 ♠');
    expect(flushRow.completion.outs).toHaveLength(9);
    expect(flushRow.completion.turnCount).toBe(9);
    expect(flushRow.completion.turnTotal).toBe(47);
    expect(flushRow.completion.riverCount).toBe(378);
    expect(flushRow.completion.riverTotal).toBe(TOTAL);
    expect(flushRow.completion.turnProbability).toBeCloseTo(9 / 47, 12);
    expect(flushRow.completion.riverProbability).toBeCloseTo(378 / TOTAL, 12);
  });

  it('两头顺 8 张补牌：转牌 8/47，到河牌 340/1081', () => {
    const analysis = analyzeHeroDraws(scenario('9s 8d', '6c 7h Kd'));
    const row = rowFor(analysis.rows, HandCategory.Straight);

    expect(row.kind).toBe('straight-open');
    expect(row.outRanks).toEqual([10, 5]);
    expect(row.completion.outs).toHaveLength(8);
    expect(row.completion.turnCount).toBe(8);
    expect(row.completion.riverCount).toBe(340);
    expect(row.completion.riverProbability).toBeCloseTo(340 / TOTAL, 12);
  });

  it('卡顺 4 张补牌：转牌 4/47，到河牌 178/1081', () => {
    const analysis = analyzeHeroDraws(scenario('9s 8d', '5c 6h Kd'));
    const row = rowFor(analysis.rows, HandCategory.Straight);

    expect(row.kind).toBe('straight-gutshot');
    expect(row.outRanks).toEqual([7]);
    expect(row.completion.outs).toHaveLength(4);
    expect(row.completion.riverCount).toBe(178);
    expect(row.completion.riverProbability).toBeCloseTo(178 / TOTAL, 12);
  });

  it('补牌列表恰好是「能补成目标」的牌', () => {
    const flopScenario = scenario('9s 8d', '5c 6h Kd');
    const row = rowFor(analyzeHeroDraws(flopScenario).rows, HandCategory.Straight);
    const base = [...flopScenario.hero, ...flopScenario.flop];
    const outs = new Set(row.completion.outs.map(cardKey));

    for (const card of row.completion.outs) {
      expect(naiveHasStraight([...base, card])).toBe(true);
    }
    for (const card of getRemainingDeck(flopScenario)) {
      expect(naiveHasStraight([...base, card])).toBe(outs.has(cardKey(card)));
    }
  });

  it('后门同花（3 张同花）：转牌 0，到河牌 C(10,2)=45', () => {
    const analysis = analyzeHeroDraws(scenario('Ah Ks', 'Qh 7s 2h'));
    const row = rowFor(analysis.rows, HandCategory.Flush);

    expect(row.backdoor).toBe(true);
    expect(row.label).toBe('后门同花听牌 ♥');
    expect(row.completion.outs).toHaveLength(0);
    expect(row.completion.turnCount).toBe(0);
    expect(row.completion.riverCount).toBe(45);
    expect(row.completion.riverProbability).toBeCloseTo(45 / TOTAL, 12);
  });

  it('后门顺子（需要连来 J 与 T）', () => {
    const analysis = analyzeHeroDraws(scenario('As Ks', 'Qs 7s 2h'));
    const row = rowFor(analysis.rows, HandCategory.Straight);

    expect(row.backdoor).toBe(true);
    expect(row.label).toBe('后门顺子听牌');
    expect(row.completion.riverCount).toBe(4 * 4);
  });

  it('至少补成一种听牌 = 各听牌的并集', () => {
    const analysis = analyzeHeroDraws(scenario('Ah 3h', '7c 5c 4c'));
    expect(analysis.rows).toHaveLength(2);
    // 两头顺 340 + 后门同花 45 - 交集 17 = 368
    expect(analysis.union.riverCount).toBe(368);
    expect(analysis.union.turnCount).toBe(8);
    expect(analysis.union.riverProbability).toBeCloseTo(368 / TOTAL, 12);
  });
});

describe('Hero 听牌：已经成型的牌型不算听牌', () => {
  it('已成同花时不再报同花听牌', () => {
    const analysis = analyzeHeroDraws(scenario('As Ks', 'Qs 7s 2s'));
    expect(analysis.rows.some((row) => row.target === HandCategory.Flush)).toBe(
      false,
    );
  });

  it('已成顺子时不再报顺子听牌', () => {
    const analysis = analyzeHeroDraws(scenario('9s 8d', '6c 7h Td'));
    expect(
      analysis.rows.some((row) => row.target === HandCategory.Straight),
    ).toBe(false);
  });

  it('葫芦不含同花，同花候选不存在时不报同花听牌', () => {
    const analysis = analyzeHeroDraws(scenario('Ah As', 'Ad Kh Ks'));
    expect(analysis.rows).toHaveLength(0);
    expect(analysis.union.riverCount).toBe(0);
  });

  it('无关牌面完全没有听牌', () => {
    const analysis = analyzeHeroDraws(scenario('As Kd', 'Ah 8c 3d'));
    expect(analysis.rows).toHaveLength(0);
    expect(analysis.union.turnCount).toBe(0);
    expect(analysis.union.riverCount).toBe(0);
  });

  it('A2345 轮子顺也算顺子（已成顺子时不再报顺子听牌）', () => {
    const analysis = analyzeHeroDraws(scenario('As 2d', '3c 4h 5s'));
    expect(
      analysis.rows.some((row) => row.target === HandCategory.Straight),
    ).toBe(false);
  });
});

describe('Hero 听牌：与朴素穷举交叉验证', () => {
  const fixtures: [string, string][] = [
    ['As Ks', 'Qs 7s 2h'],
    ['9s 8d', '6c 7h Kd'],
    ['Ah 3h', '7c 5c 4c'],
    ['Jd 4c', 'Jh 9s 2d'],
    ['2h 3d', 'Ks 9s 4s'],
  ];

  for (const [hero, flop] of fixtures) {
    it(`Hero ${hero} / ${flop}`, () => {
      const flopScenario = scenario(hero, flop);
      const analysis = analyzeHeroDraws(flopScenario);

      for (const target of ['flush', 'straight'] as const) {
        const expected = bruteForceHero(flopScenario, target);
        const category =
          target === 'flush' ? HandCategory.Flush : HandCategory.Straight;
        const row = analysis.rows.find((item) => item.target === category);
        if (row) {
          expect(row.completion.turnCount).toBe(expected.turnCount);
          expect(row.completion.riverCount).toBe(expected.riverCount);
          expect(row.completion.outs).toHaveLength(expected.outs);
        } else {
          // 没有听牌行 ⇒ 到河牌一次都补不成。
          expect(expected.riverCount).toBe(0);
        }
      }
    });
  }
});

describe('对手听牌：结构与不变量', () => {
  const fixture = scenario('Ah 3h', '7c 5c 4c');
  const opponent = analyzeOpponentDraws(fixture);

  it('组合总数与后续总数', () => {
    expect(opponent.totalCombos).toBe(TOTAL);
    expect(opponent.turnTotal).toBe(45);
    expect(opponent.riverTotal).toBe(OPPONENT_RIVER_TOTAL);
  });

  it('有立即听牌 + 只有后门 + 没有听牌 = 1081', () => {
    expect(
      opponent.immediateCombos + opponent.backdoorOnlyCombos + opponent.noDrawCombos,
    ).toBe(TOTAL);
    expect(opponent.drawingCombos).toBe(
      opponent.immediateCombos + opponent.backdoorOnlyCombos,
    );
  });

  it('3 张同花翻牌时对手同花听牌的组合数可精确算出', () => {
    // 翻牌 7c 5c 4c：剩余 47 张里有 10 张梅花。
    // 同花听牌 = 手牌至少 1 张梅花（3 + 1 = 4 张）且还没有成同花：
    // C(47,2) - C(37,2) - C(10,2) = 1081 - 666 - 45 = 370。
    const flushRow = opponent.rows.find((row) => row.kind === 'flush');
    expect(flushRow).toBeDefined();
    expect(flushRow!.comboCount).toBe(370);
    // 手牌 1 张梅花时牌池里正好剩 9 张梅花、45 张未知牌。
    expect(flushRow!.averageTurnProbability).toBeCloseTo(9 / 45, 12);
    expect(flushRow!.averageRiverProbability).toBeCloseTo(360 / 990, 12);
  });

  it('每一类听牌的补成率单调：转牌 ≤ 到河牌，且都在 [0,1]', () => {
    for (const row of opponent.rows) {
      expect(row.averageTurnProbability).toBeLessThanOrEqual(
        row.averageRiverProbability,
      );
      expect(row.averageTurnProbability).toBeGreaterThanOrEqual(0);
      expect(row.averageRiverProbability).toBeLessThanOrEqual(1);
      expect(row.probability).toBeLessThanOrEqual(1);
      // 「拿到且补成」= 组合占比 × 平均补成率。
      expect(row.jointRiverProbability).toBeCloseTo(
        row.probability * row.averageRiverProbability,
        12,
      );
    }
  });

  it('后门行只有到河牌概率，且条件补成率 ≤ 1', () => {
    expect(opponent.backdoorRow).not.toBeNull();
    expect(opponent.backdoorRow!.averageTurnProbability).toBe(0);
    expect(opponent.backdoorRow!.averageRiverProbability).toBeGreaterThan(0);
    expect(opponent.backdoorRow!.averageRiverProbability).toBeLessThanOrEqual(1);
  });

  it('整体「拿到听牌并补成」不超过「有听牌」的比例', () => {
    expect(opponent.completeProbability).toBeLessThanOrEqual(
      opponent.drawingCombos / TOTAL,
    );
    expect(opponent.completeConditionalProbability).toBeLessThanOrEqual(1);
    expect(opponent.completeProbability).toBeGreaterThanOrEqual(0);
  });

  it('同花听牌平均下来约等于 9 张补牌的理论值（翻牌 3 同花 + 1 同花底牌的常见形态）', () => {
    const flushRow = opponent.rows.find((row) => row.kind === 'flush')!;
    expect(flushRow.averageTurnProbability).toBeCloseTo(9 / 45, 12);
  });
});

describe('随机牌面不变量', () => {
  const scenarios = Array.from({ length: 30 }, () => generateRandomFlopScenario());

  it('Hero 听牌结构自洽', () => {
    for (const flopScenario of scenarios) {
      const hero = analyzeHeroDraws(flopScenario);
      expect(hero.turnTotal).toBe(47);
      expect(hero.riverTotal).toBe(TOTAL);
      expect(hero.union.turnCount).toBeLessThanOrEqual(hero.union.riverCount);
      expect(hero.union.riverCount).toBeLessThanOrEqual(TOTAL);

      for (const row of hero.rows) {
        expect(row.completion.turnCount).toBe(row.completion.outs.length);
        expect(row.completion.turnTotal).toBe(47);
        expect(row.completion.riverTotal).toBe(TOTAL);
        if (row.backdoor) {
          expect(row.completion.turnCount).toBe(0);
          expect(row.completion.riverCount).toBeGreaterThan(0);
        } else {
          expect(row.completion.turnCount).toBeGreaterThan(0);
        }
        expect(row.completion.riverCount).toBeGreaterThanOrEqual(
          row.completion.turnCount,
        );
        if (!row.backdoor && row.kind !== 'flush') {
          // 顺子听牌的补牌是 1~3 个点数 × 每点 4 张。
          expect(row.completion.outs.length % 4).toBe(0);
          expect(row.completion.outs.length).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it('对手听牌分类与并集自洽', () => {
    for (const flopScenario of scenarios) {
      const opponent = analyzeOpponentDraws(flopScenario);
      expect(opponent.totalCombos).toBe(TOTAL);
      expect(
        opponent.immediateCombos +
          opponent.backdoorOnlyCombos +
          opponent.noDrawCombos,
      ).toBe(TOTAL);
      expect(opponent.drawingCombos).toBeLessThanOrEqual(TOTAL);
      expect(opponent.completeProbability).toBeLessThanOrEqual(
        opponent.drawingCombos / TOTAL,
      );
      for (const row of opponent.rows) {
        expect(row.comboCount).toBeGreaterThan(0);
        expect(row.averageTurnProbability).toBeLessThanOrEqual(
          row.averageRiverProbability,
        );
      }
      // 立即听牌分类可以重叠，因此分类之和 ≥ 有立即听牌的组合数。
      const sum = opponent.rows.reduce((acc, row) => acc + row.comboCount, 0);
      expect(sum).toBeGreaterThanOrEqual(opponent.immediateCombos);
    }
  });

  it('analyzeDraws 同时给出两侧结果', () => {
    const flopScenario = scenarios[0];
    const both = analyzeDraws(flopScenario);
    expect(both.hero.rows).toEqual(analyzeHeroDraws(flopScenario).rows);
    expect(both.opponent.totalCombos).toBe(
      analyzeOpponentDraws(flopScenario).totalCombos,
    );
  });
});
