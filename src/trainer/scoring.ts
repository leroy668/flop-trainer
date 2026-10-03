/** 答题评分。 */

import type { FlopAnalysis } from '../poker/analyzer';
import type { HandCategory } from '../poker/evaluator';
import { isTrainableCategory } from '../poker/evaluator';
import { getProbabilityRange } from './ranges';
import type { TrainerAnswer, TrainerStats } from './types';

export interface CategoryScore {
  category: HandCategory;
  actualProbability: number;
  correctRangeId: string;
  userRangeId?: string;
  rangeCorrect: boolean;
}

export interface ScoreResult {
  /** 实际存在领先组合的牌型。 */
  actualCategories: HandCategory[];
  /** 用户选择的牌型。 */
  selectedCategories: HandCategory[];
  /** 用户漏选的牌型。 */
  missedCategories: HandCategory[];
  /** 用户多选的牌型（实际不存在领先组合）。 */
  extraCategories: HandCategory[];

  categoryPerfect: boolean;
  categoryRangeScores: CategoryScore[];
  categoryRangeCorrect: number;
  categoryRangeTotal: number;

  sameCategoryCorrect: boolean;
  sameCategoryTotal: number;
  sameCategoryActualRangeId?: string;
  sameCategoryUserRangeId?: string;
}

export function scoreAnswer(
  answer: TrainerAnswer,
  analysis: FlopAnalysis,
): ScoreResult {
  const actualCategories = analysis.byCategory
    .filter(
      (entry) => entry.aheadCount > 0 && isTrainableCategory(entry.category),
    )
    .map((entry) => entry.category);

  const selectedCategories = [...answer.selectedCategories]
    .filter(isTrainableCategory)
    .sort((a, b) => a - b);
  const actualSet = new Set(actualCategories);
  const selectedSet = new Set(selectedCategories);

  const missedCategories = actualCategories.filter((c) => !selectedSet.has(c));
  const extraCategories = selectedCategories.filter((c) => !actualSet.has(c));

  const categoryPerfect =
    missedCategories.length === 0 && extraCategories.length === 0;

  const categoryRangeScores: CategoryScore[] = actualCategories.map((category) => {
    const entry = analysis.byCategory.find((item) => item.category === category)!;
    const correctRangeId = getProbabilityRange(entry.aheadProbability).id;
    const userRangeId = answer.categoryProbabilityAnswers[category];
    return {
      category,
      actualProbability: entry.aheadProbability,
      correctRangeId,
      userRangeId,
      rangeCorrect: userRangeId === correctRangeId,
    };
  });

  // 「同牌型」一题只针对成牌：Hero 是高牌时不要求作答，也不计入统计。
  const sameCategoryAsked =
    analysis.sameCategory.totalCount > 0 &&
    isTrainableCategory(analysis.sameCategory.category);
  const sameCategoryTotal = sameCategoryAsked ? 1 : 0;
  const sameCategoryActualRangeId = sameCategoryAsked
    ? getProbabilityRange(analysis.sameCategory.aheadConditionalProbability).id
    : undefined;
  const sameCategoryCorrect =
    !sameCategoryAsked ||
    answer.sameCategoryAheadRangeId === sameCategoryActualRangeId;

  return {
    actualCategories,
    selectedCategories,
    missedCategories,
    extraCategories,
    categoryPerfect,
    categoryRangeScores,
    categoryRangeCorrect: categoryRangeScores.filter((s) => s.rangeCorrect).length,
    categoryRangeTotal: categoryRangeScores.length,
    sameCategoryCorrect,
    sameCategoryTotal,
    sameCategoryActualRangeId,
    sameCategoryUserRangeId: answer.sameCategoryAheadRangeId,
  };
}

export function updateTrainerStats(
  stats: TrainerStats,
  score: ScoreResult,
): TrainerStats {
  const questionCorrect =
    score.categoryPerfect &&
    score.categoryRangeCorrect === score.categoryRangeTotal &&
    score.sameCategoryCorrect;

  return {
    totalQuestions: stats.totalQuestions + 1,
    categoryPerfectCount: stats.categoryPerfectCount + (score.categoryPerfect ? 1 : 0),
    categoryRangeCorrect: stats.categoryRangeCorrect + score.categoryRangeCorrect,
    categoryRangeTotal: stats.categoryRangeTotal + score.categoryRangeTotal,
    sameCategoryRangeCorrect:
      stats.sameCategoryRangeCorrect +
      (score.sameCategoryTotal > 0 && score.sameCategoryCorrect ? 1 : 0),
    sameCategoryRangeTotal:
      stats.sameCategoryRangeTotal + score.sameCategoryTotal,
    currentStreak: questionCorrect ? stats.currentStreak + 1 : 0,
  };
}
