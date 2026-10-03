/** 训练器 UI 状态与答案类型。 */

import type { HandCategory } from '../poker/evaluator';

export interface ProbabilityRange {
  id: string;
  min: number;
  max: number;
  label: string;
}

export interface TrainerAnswer {
  selectedCategories: HandCategory[];

  /** key = HandCategory，value = ProbabilityRange.id */
  categoryProbabilityAnswers: Partial<Record<HandCategory, string>>;

  sameCategoryAheadRangeId?: string;
}

export interface TrainerStats {
  totalQuestions: number;

  categoryPerfectCount: number;

  categoryRangeCorrect: number;
  categoryRangeTotal: number;

  sameCategoryRangeCorrect: number;
  sameCategoryRangeTotal: number;

  currentStreak: number;
}

export const EMPTY_TRAINER_STATS: TrainerStats = {
  totalQuestions: 0,
  categoryPerfectCount: 0,
  categoryRangeCorrect: 0,
  categoryRangeTotal: 0,
  sameCategoryRangeCorrect: 0,
  sameCategoryRangeTotal: 0,
  currentStreak: 0,
};

export type TrainerPhase =
  | 'answer-categories'
  | 'answer-category-probabilities'
  | 'answer-same-category'
  | 'result';
