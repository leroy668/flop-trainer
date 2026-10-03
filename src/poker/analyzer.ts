/**
 * 核心分析：枚举 1081 个对手组合，评价、比较并聚合。
 *
 * 所有概率都来自完整的
 *   52 张牌 -> 移除 5 张已知牌 -> 枚举 C(47,2)=1081 -> 评价 -> 比较 -> 聚合
 * 流程，禁止任何硬编码。
 */

import type { FlopScenario } from './cards';
import { getRemainingDeck } from './cards';
import type { HoleCards } from './combinations';
import { enumerateOpponentHands } from './combinations';
import type { CompareResult } from './compare';
import { compareHandValues } from './compare';
import type { HandValue } from './evaluator';
import {
  ALL_HAND_CATEGORIES,
  evaluateFiveCards,
  HandCategory,
  rankValueToLabel,
} from './evaluator';
import { getRankGroup, rankGroupSortValue } from './grouping';

export const TOTAL_OPPONENT_COMBOS = 1081;

export type Comparison = 'ahead' | 'tie' | 'behind';

export interface OpponentHandResult {
  holeCards: HoleCards;
  handValue: HandValue;
  category: HandValue['category'];
  /** ahead 表示“对手领先 Hero”。 */
  comparison: Comparison;
  /** 忽略花色的点数类型，例如 A8 / 88 / JT。 */
  rankGroup: string;
}

export interface RankGroupAnalysis {
  label: string;
  /** 组合数量（行内全部成员的总和）。 */
  comboCount: number;
  /** comboCount / 1081。 */
  probability: number;
  /**
   * 行名列出的成员类型个数（未合并时为 1）。
   * 同一行内每个成员的组合数与概率都相同，所以：
   * 单个成员概率 = probability / memberCount。
   */
  memberCount: number;
  /**
   * 可选的二级分类标题，目前不再输出（分类已写进行名，如「配对公共牌 K / 9 / 6」）。
   */
  subgroup?: string;
  /** 每一个实际花色组合。 */
  combos: HoleCards[];
}

export interface CategoryAnalysis {
  category: HandValue['category'];
  /** 对手最终属于这个牌型的全部组合数量。 */
  totalCount: number;
  /** 属于这个牌型且能压过 Hero 的组合数量。 */
  aheadCount: number;
  /** aheadCount / 1081。 */
  aheadProbability: number;
  /** 只包含确实压过 Hero 的组合。 */
  groups: RankGroupAnalysis[];
}

export interface SameCategoryAnalysis {
  category: HandValue['category'];
  totalCount: number;
  aheadCount: number;
  tieCount: number;
  behindCount: number;
  aheadConditionalProbability: number;
  tieConditionalProbability: number;
  behindConditionalProbability: number;
  /** 同牌型中能压过 Hero 的具体点数类型。 */
  aheadGroups: RankGroupAnalysis[];
}

export interface FlopAnalysis {
  scenario: FlopScenario;
  heroHandValue: HandValue;
  totalOpponentCombos: number;

  aheadCount: number;
  tieCount: number;
  behindCount: number;

  aheadProbability: number;
  tieProbability: number;
  behindProbability: number;

  byCategory: CategoryAnalysis[];
  sameCategory: SameCategoryAnalysis;

  results: OpponentHandResult[];
}

/**
 * 同一牌型内的展示分组标签与排序值。
 *
 * 大多数牌型直接使用「两张底牌点数」（A8 / 88 / KQ ...）。
 *
 * 两处特殊化：
 * - 「一对」：先按成对点数分组（一对K / 一对9 ...），并标记二级分类：
 *   「配对公共牌」（一张手牌配上翻牌）或「口袋对」（两张手牌本身成对）。
 * - 「同花」：只看高张（A高同花 / K高同花 ...），否则公共牌三张同花时
 *   会拆成最多 45 行、每行只有 1 个组合。
 *
 * 合并行名需要「短名」与「共同后缀」，所以这里一并给出：
 * 一对K → tone K；A高同花 → tone A + suffix 高同花；其余牌型短名就是原标签。
 */
function getGroupDescriptor(result: OpponentHandResult): {
  label: string;
  /** 同概率合并时拼行名用的短名。 */
  mergeToken: string;
  /** 合并行名的共同后缀，例如「高同花」。 */
  mergeSuffix?: string;
  sortValue: number;
  subgroup?: string;
  subgroupOrder: number;
} {
  if (result.category === HandCategory.OnePair) {
    const pairRank = result.handValue.tiebreak[0];
    const rank = rankValueToLabel(pairRank);
    // 两张手牌本身成对即为口袋对；否则只能是其中一张配上了公共牌。
    const isPocketPair =
      result.holeCards[0].rank === result.holeCards[1].rank;
    return {
      label: `一对${rank}`,
      mergeToken: rank,
      sortValue: pairRank,
      subgroup: isPocketPair ? '口袋对' : '配对公共牌',
      subgroupOrder: isPocketPair ? 1 : 0,
    };
  }
  if (result.category === HandCategory.Flush) {
    const topRank = result.handValue.tiebreak[0];
    const rank = rankValueToLabel(topRank);
    return {
      label: `${rank}高同花`,
      mergeToken: rank,
      mergeSuffix: '高同花',
      sortValue: topRank,
      subgroupOrder: 0,
    };
  }
  return {
    label: result.rankGroup,
    mergeToken: result.rankGroup,
    sortValue: rankGroupSortValue(result.rankGroup),
    subgroupOrder: 0,
  };
}

interface DescribedGroup {
  label: string;
  mergeToken: string;
  mergeSuffix?: string;
  sortValue: number;
  subgroup?: string;
  subgroupOrder: number;
  comboCount: number;
  combos: HoleCards[];
}

function groupAheadResults(
  results: readonly OpponentHandResult[],
): RankGroupAnalysis[] {
  const map = new Map<string, DescribedGroup>();
  for (const result of results) {
    const descriptor = getGroupDescriptor(result);
    const bucket = map.get(descriptor.label);
    if (bucket) {
      bucket.comboCount += 1;
      bucket.combos.push(result.holeCards);
    } else {
      map.set(descriptor.label, {
        ...descriptor,
        comboCount: 1,
        combos: [result.holeCards],
      });
    }
  }

  const groups = [...map.values()];
  groups.sort((a, b) => {
    if (a.subgroupOrder !== b.subgroupOrder) {
      return a.subgroupOrder - b.subgroupOrder;
    }
    if (b.comboCount !== a.comboCount) return b.comboCount - a.comboCount;
    return b.sortValue - a.sortValue;
  });

  return mergeSameProbabilityGroups(groups);
}

/**
 * 同一牌型内概率相同（即组合数相同）的类型合成一行，行名仍把成员全部列出来，
 * 例如「配对公共牌 K / 9 / 6」342 个、「8 / 7高同花」6 个、「75 / 72 / 52」27 个。
 * 概率不同的类型各自成行，二级分类（配对公共牌 / 口袋对）不会混在一起。
 *
 * 合并后不丢信息：同一行内每个成员的概率都相等，所以行名里的成员各占
 * comboCount / 成员数 个组合。
 */
function mergeSameProbabilityGroups(
  groups: readonly DescribedGroup[],
): RankGroupAnalysis[] {
  interface MergedGroup {
    subgroup?: string;
    mergeSuffix?: string;
    /** 合并前每个成员各自的组合数（同一行内全都相等）。 */
    perMemberCount: number;
    tokens: string[];
    combos: HoleCards[];
  }

  const merged: MergedGroup[] = [];
  for (const group of groups) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.subgroup === group.subgroup &&
      previous.mergeSuffix === group.mergeSuffix &&
      previous.perMemberCount === group.comboCount
    ) {
      previous.tokens.push(group.mergeToken);
      previous.combos.push(...group.combos);
      continue;
    }
    merged.push({
      subgroup: group.subgroup,
      mergeSuffix: group.mergeSuffix,
      perMemberCount: group.comboCount,
      tokens: [group.mergeToken],
      combos: [...group.combos],
    });
  }

  return merged.map((group) => {
    const joined = group.tokens.join(' / ');
    return {
      label: group.subgroup
        ? `${group.subgroup} ${joined}`
        : `${joined}${group.mergeSuffix ?? ''}`,
      comboCount: group.combos.length,
      probability: group.combos.length / TOTAL_OPPONENT_COMBOS,
      memberCount: group.tokens.length,
      // 行名里已经写了二级分类，不再额外渲染小标题。
      subgroup: undefined,
      combos: group.combos,
    };
  });
}

export function analyzeFlopScenario(scenario: FlopScenario): FlopAnalysis {
  const heroCards = [...scenario.hero, ...scenario.flop];
  const heroHandValue = evaluateFiveCards(heroCards);

  const remainingDeck = getRemainingDeck(scenario);
  const opponentHands = enumerateOpponentHands(remainingDeck);

  const results: OpponentHandResult[] = opponentHands.map((holeCards) => {
    const opponentValue = evaluateFiveCards([...holeCards, ...scenario.flop]);
    const comparisonValue: CompareResult = compareHandValues(
      opponentValue,
      heroHandValue,
    );
    const comparison: Comparison =
      comparisonValue > 0 ? 'ahead' : comparisonValue < 0 ? 'behind' : 'tie';
    return {
      holeCards,
      handValue: opponentValue,
      category: opponentValue.category,
      comparison,
      rankGroup: getRankGroup(holeCards),
    };
  });

  let aheadCount = 0;
  let tieCount = 0;
  let behindCount = 0;
  for (const result of results) {
    if (result.comparison === 'ahead') aheadCount += 1;
    else if (result.comparison === 'tie') tieCount += 1;
    else behindCount += 1;
  }

  const total = results.length;

  const byCategory: CategoryAnalysis[] = ALL_HAND_CATEGORIES.map((category) => {
    const inCategory = results.filter((result) => result.category === category);
    const aheadInCategory = inCategory.filter(
      (result) => result.comparison === 'ahead',
    );
    return {
      category,
      totalCount: inCategory.length,
      aheadCount: aheadInCategory.length,
      aheadProbability: aheadInCategory.length / total,
      groups: groupAheadResults(aheadInCategory),
    };
  });

  const sameCategoryResults = results.filter(
    (result) => result.category === heroHandValue.category,
  );
  const sameAhead = sameCategoryResults.filter(
    (result) => result.comparison === 'ahead',
  );
  const sameTie = sameCategoryResults.filter(
    (result) => result.comparison === 'tie',
  );
  const sameBehind = sameCategoryResults.filter(
    (result) => result.comparison === 'behind',
  );

  const sameCategory: SameCategoryAnalysis = {
    category: heroHandValue.category,
    totalCount: sameCategoryResults.length,
    aheadCount: sameAhead.length,
    tieCount: sameTie.length,
    behindCount: sameBehind.length,
    aheadConditionalProbability:
      sameCategoryResults.length > 0
        ? sameAhead.length / sameCategoryResults.length
        : 0,
    tieConditionalProbability:
      sameCategoryResults.length > 0
        ? sameTie.length / sameCategoryResults.length
        : 0,
    behindConditionalProbability:
      sameCategoryResults.length > 0
        ? sameBehind.length / sameCategoryResults.length
        : 0,
    aheadGroups: groupAheadResults(sameAhead),
  };

  return {
    scenario,
    heroHandValue,
    totalOpponentCombos: total,
    aheadCount,
    tieCount,
    behindCount,
    aheadProbability: aheadCount / total,
    tieProbability: tieCount / total,
    behindProbability: behindCount / total,
    byCategory,
    sameCategory,
    results,
  };
}
