import { describe, expect, it } from 'vitest';
import {
  buildFlopTaxonomy,
  describeFlopSplit,
  FLOP_TYPE_GROUPS,
} from '../src/poker/flopTaxonomy';
import { createDeck } from '../src/poker/cards';
import type { Card } from '../src/poker/cards';
import { HandCategory } from '../src/poker/evaluator';
import { analyzeHeroDraws } from '../src/poker/draws';
import { summarizeFiveCardHand } from '../src/poker/handType';

/** 全量枚举一次（约 3 秒），后面的测试都复用。 */
const taxonomy = buildFlopTaxonomy();

const TOTAL_COMBOS = 25_989_600;
const TOTAL_FIVE_CARD_SETS = 2_598_960;
const ORBIT_COUNT = 134_459;

/** 教科书里的 5 张牌型频率（每种切分都会得到同样的牌型，所以这里要 ×10）。 */
const FIVE_CARD_CATEGORY_COUNTS: Record<HandCategory, number> = {
  [HandCategory.HighCard]: 1_302_540,
  [HandCategory.OnePair]: 1_098_240,
  [HandCategory.TwoPair]: 123_552,
  [HandCategory.Trips]: 54_912,
  [HandCategory.Straight]: 10_200,
  [HandCategory.Flush]: 5_108,
  [HandCategory.FullHouse]: 3_744,
  [HandCategory.Quads]: 624,
  [HandCategory.StraightFlush]: 40,
};

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('flopTaxonomy 枚举规模', () => {
  it('等价类数量与总组合数正确', () => {
    expect(taxonomy.orbitCount).toBe(ORBIT_COUNT);
    expect(taxonomy.orbitCount * 24).toBeGreaterThan(TOTAL_FIVE_CARD_SETS);
    expect(taxonomy.total).toBe(TOTAL_COMBOS);
  });

  it('明细行与合并行的组合数之和都等于总数', () => {
    expect(taxonomy.rows.reduce((sum, row) => sum + row.count, 0)).toBe(
      TOTAL_COMBOS,
    );
    expect(taxonomy.madeRows.reduce((sum, row) => sum + row.count, 0)).toBe(
      TOTAL_COMBOS,
    );
    expect(
      taxonomy.groupTotals.reduce((sum, group) => sum + group.count, 0),
    ).toBe(TOTAL_COMBOS);
  });

  it('每个牌型类别的组合数 = 5 张牌教科书频率 × 10', () => {
    const byCategory = new Map<HandCategory, number>();
    for (const row of taxonomy.madeRows) {
      byCategory.set(
        row.category,
        (byCategory.get(row.category) ?? 0) + row.count,
      );
    }
    for (const [category, fiveCardCount] of Object.entries(
      FIVE_CARD_CATEGORY_COUNTS,
    )) {
      expect(byCategory.get(Number(category) as HandCategory)).toBe(
        fiveCardCount * 10,
      );
    }
    expect(byCategory.size).toBe(9);
  });

  it('大类的概率之和为 100%', () => {
    expect(taxonomy.groupTotals.map((group) => group.group)).toEqual([
      ...FLOP_TYPE_GROUPS,
    ]);
    const sum = taxonomy.groupTotals.reduce(
      (acc, group) => acc + group.probability,
      0,
    );
    expect(sum).toBeCloseTo(1, 12);
  });

  it('高牌且没有任何听牌（空气）刚好 474,000 种', () => {
    const air = taxonomy.madeRows.find(
      (row) => row.label === '空气（没有成牌，也没有听牌）',
    );
    expect(air?.count).toBe(474_000);
  });
});

describe('flopTaxonomy 归类一致性', () => {
  it('合并行 = 明细行按已成牌（高牌按听牌档位）汇总', () => {
    const sums = new Map<string, number>();
    for (const row of taxonomy.rows) {
      let key: string;
      if (row.category !== HandCategory.HighCard) {
        key = row.madeHand;
      } else if (row.hasImmediateDraw) {
        key = '高牌 + 立即听牌';
      } else if (row.hasBackdoorDraw) {
        key = '高牌 + 后门听牌';
      } else {
        key = '空气（没有成牌，也没有听牌）';
      }
      sums.set(key, (sums.get(key) ?? 0) + row.count);
    }
    for (const row of taxonomy.madeRows) {
      expect(sums.get(row.label)).toBe(row.count);
      expect(row.memberCount).toBe(
        taxonomy.rows.filter((detail) => {
          if (row.label === '高牌 + 立即听牌') {
            return (
              detail.category === HandCategory.HighCard &&
              detail.hasImmediateDraw
            );
          }
          if (row.label === '高牌 + 后门听牌') {
            return (
              detail.category === HandCategory.HighCard &&
              !detail.hasImmediateDraw &&
              detail.hasBackdoorDraw
            );
          }
          if (row.label === '空气（没有成牌，也没有听牌）') {
            return (
              detail.category === HandCategory.HighCard &&
              !detail.hasImmediateDraw &&
              !detail.hasBackdoorDraw
            );
          }
          return detail.madeHand === row.label;
        }).length,
      );
    }
  });

  it('每一行的例子都是 5 张不同的牌，且与行名一致', () => {
    for (const row of [...taxonomy.rows, ...taxonomy.madeRows]) {
      const cards = [...row.example.hero, ...row.example.flop];
      expect(cards).toHaveLength(5);
      const keys = new Set(cards.map((card) => `${card.rank}${card.suit}`));
      expect(keys.size).toBe(5);
      if ('label' in row && 'madeHand' in row) {
        const detail = describeFlopSplit(cards, [0, 1]);
        // 明细行的例子必须真的属于这一行（合并行只校验成牌部分）
        if (row.madeHand === detail.madeHand) {
          expect(detail.label).toBe(row.label);
        }
      }
    }
  });

  it('与结果页「当前 5 张牌」口径完全一致（随机抽样）', () => {
    const random = mulberry32(20250607);
    const deck = createDeck();
    for (let round = 0; round < 400; round += 1) {
      const pool: Card[] = [...deck];
      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const five = pool.slice(0, 5);
      const draws = analyzeHeroDraws({
        hero: [five[0], five[1]],
        flop: [five[2], five[3], five[4]],
      });
      for (let i = 0; i < 5; i += 1) {
        for (let j = i + 1; j < 5; j += 1) {
          const hero: [Card, Card] = [five[i], five[j]];
          const flop = five.filter(
            (_, index) => index !== i && index !== j,
          ) as unknown as [Card, Card, Card];
          const reference = summarizeFiveCardHand({ hero, flop }, draws);
          const mine = describeFlopSplit(five, [i, j]);
          expect(mine.madeHand).toBe(reference.madeHand);
          const refDraws = reference.draws.map((draw) =>
            draw.label.replace(/ [♠♥♦♣]/g, ''),
          );
          // 听牌的集合必须一致（顺序：立即听牌在前，同类顺序不强制）
          expect([...mine.draws].sort()).toEqual([...refDraws].sort());
          if (mine.category === HandCategory.HighCard && mine.draws.length === 0) {
            expect(mine.label).toBe('空气（没有成牌，也没有听牌）');
            expect(reference.summary).toBe('空气（没有成牌，也没有听牌）');
          } else {
            const referenceParts = reference.summary
              .replace(/ [♠♥♦♣]/g, '')
              .split(' + ');
            expect([mine.madeHand, ...mine.draws].sort()).toEqual(
              referenceParts.sort(),
            );
          }
          expect(mine.category).toBe(reference.category);
        }
      }
    }
  });
});
