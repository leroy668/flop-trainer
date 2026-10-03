/**
 * 「现在这几张牌，发完之后会变成什么」——把剩余公共牌的所有等权后续
 * 枚举一遍，统计 Hero 最终牌型的分布。
 *
 * 口径：
 * - 翻牌圈：剩余 47 张未知牌里取 2 张（转牌 + 河牌），C(47,2) = 1081 个等权后续；
 *   转牌圈：46 张里取 1 张；河牌圈：已经定型，只有 1 种结果。
 * - 每个后续都按「7 张取最优五张」评价，所以最终牌型一定不弱于当前牌型
 *   （已知的 5 张牌永远可以继续用），worsenCount 恒为 0，这里也算出来当断言用。
 * - 分布按牌型归类（9 类），只列出真实出现过的牌型，
 *   于是 1081 个后续被总结成「两对 12.3% / 三条 2.1% / …」这样的类型表。
 */

import type { Scenario } from './cards';
import { getRemainingDeck, knownCards, remainingBoardCards } from './cards';
import { pairCount } from './combinations';
import type { HandCategory } from './evaluator';
import { evaluateBestHand, HAND_CATEGORY_LABELS } from './evaluator';

export interface HeroOutlookRow {
  category: HandCategory;
  label: string;
  /** 最终成为该牌型的等权后续个数。 */
  count: number;
  probability: number;
  /** 相对当前牌型：没提升 / 提升了。 */
  change: 'same' | 'improve';
}

export interface HeroOutlook {
  /** 等权后续总数：翻牌 1081 / 转牌 46 / 河牌 1。 */
  total: number;
  /** 还要发几张公共牌。 */
  remainingBoardCards: number;
  currentCategory: HandCategory;
  currentLabel: string;
  /** 最高能补成的牌型；已经定型时为 null。 */
  bestCategory: HandCategory | null;
  bestLabel: string | null;
  bestCount: number;
  bestProbability: number;
  /** 最终牌型严格高于当前的后续数（提升概率）。 */
  improveCount: number;
  improveProbability: number;
  /** 最终牌型与当前相同的后续数（保持）。 */
  stayCount: number;
  stayProbability: number;
  /** 最终牌型低于当前的后续数，理论上恒为 0。 */
  worsenCount: number;
  /** 9 类牌型的分布，只保留出现过的，按牌型从高到低。 */
  rows: HeroOutlookRow[];
}

/**
 * 枚举剩余公共牌的所有取法，统计 Hero 最终牌型。
 * 只可能还要发 0 / 1 / 2 张，直接分三种情况写，避免通用组合的开销。
 */
export function analyzeHeroOutlook(scenario: Scenario): HeroOutlook {
  const base = knownCards(scenario);
  const pool = getRemainingDeck(scenario);
  const remaining = remainingBoardCards(scenario);
  const current = evaluateBestHand(base);

  const counts = new Map<HandCategory, number>();
  const add = (category: HandCategory) => {
    counts.set(category, (counts.get(category) ?? 0) + 1);
  };

  if (remaining >= 2) {
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        add(evaluateBestHand([...base, pool[i], pool[j]]).category);
      }
    }
  } else if (remaining === 1) {
    for (const card of pool) {
      add(evaluateBestHand([...base, card]).category);
    }
  } else {
    add(current.category);
  }

  const total =
    remaining >= 2 ? pairCount(pool.length) : remaining === 1 ? pool.length : 1;

  const rows: HeroOutlookRow[] = [...counts.entries()]
    .map(
      ([category, count]): HeroOutlookRow => ({
        category,
        label: HAND_CATEGORY_LABELS[category],
        count,
        probability: count / total,
        change: category > current.category ? 'improve' : 'same',
      }),
    )
    .sort((a, b) => b.category - a.category);

  const improved = rows.filter((row) => row.category > current.category);
  const improveCount = improved.reduce((sum, row) => sum + row.count, 0);
  const best = improved[0] ?? null;
  const stayCount =
    rows.find((row) => row.category === current.category)?.count ?? 0;

  return {
    total,
    remainingBoardCards: remaining,
    currentCategory: current.category,
    currentLabel: HAND_CATEGORY_LABELS[current.category],
    bestCategory: best?.category ?? null,
    bestLabel: best?.label ?? null,
    bestCount: best?.count ?? 0,
    bestProbability: best === null ? 0 : best.count / total,
    improveCount,
    improveProbability: improveCount / total,
    stayCount,
    stayProbability: stayCount / total,
    // 已知的 5 张牌永远在最终 7 张里，所以牌型只会变强，不会变弱。
    worsenCount: rows
      .filter((row) => row.category < current.category)
      .reduce((sum, row) => sum + row.count, 0),
    rows,
  };
}
