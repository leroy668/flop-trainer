import { describe, expect, it } from 'vitest';
import { analyzeFlopScenario } from '../src/poker/analyzer';
import { HandCategory } from '../src/poker/evaluator';
import { getProbabilityRange } from '../src/trainer/ranges';
import { scoreAnswer, updateTrainerStats } from '../src/trainer/scoring';
import type { TrainerAnswer } from '../src/trainer/types';
import { scenario } from './helpers';

function emptyAnswer(): TrainerAnswer {
  return { selectedCategories: [], categoryProbabilityAnswers: {} };
}

describe('评分：高牌不参与作答', () => {
  // Hero 一对 A：高牌根本压不过一对，本就不该出现在正确答案里。
  const pairAnalysis = analyzeFlopScenario(scenario('As Kd', 'Ah 8c 3d'));

  it('一对 A 场景的正确答案不包含高牌', () => {
    const score = scoreAnswer(emptyAnswer(), pairAnalysis);
    expect(score.actualCategories).not.toContain(HandCategory.HighCard);
  });

  // Hero 高牌，且对手的高牌能压过 Hero。
  const highCardAnalysis = analyzeFlopScenario(scenario('7d 2c', 'Ah Ks 8d'));

  it('前置条件：该场景 Hero 是高牌，且确实存在能压过的高牌组合', () => {
    expect(highCardAnalysis.heroHandValue.category).toBe(HandCategory.HighCard);
    const highCardEntry = highCardAnalysis.byCategory.find(
      (entry) => entry.category === HandCategory.HighCard,
    )!;
    expect(highCardEntry.aheadCount).toBeGreaterThan(0);
  });

  it('即使高牌能压过 Hero，也不算漏选、不影响满判', () => {
    const score = scoreAnswer(emptyAnswer(), highCardAnalysis);
    expect(score.actualCategories).not.toContain(HandCategory.HighCard);
    expect(score.missedCategories).not.toContain(HandCategory.HighCard);
  });

  it('用户即使误交高牌也不会被算作多选', () => {
    const answer = emptyAnswer();
    answer.selectedCategories = [HandCategory.HighCard];
    const score = scoreAnswer(answer, highCardAnalysis);
    expect(score.extraCategories).not.toContain(HandCategory.HighCard);
    expect(score.selectedCategories).not.toContain(HandCategory.HighCard);
  });

  it('答对所有可作答牌型 + 概率区间即可判定为牌型满分', () => {
    const answer = emptyAnswer();
    answer.selectedCategories = [...highCardAnalysis.byCategory]
      .filter(
        (entry) =>
          entry.aheadCount > 0 && entry.category !== HandCategory.HighCard,
      )
      .map((entry) => entry.category);
    for (const category of answer.selectedCategories) {
      const entry = highCardAnalysis.byCategory.find(
        (item) => item.category === category,
      )!;
      answer.categoryProbabilityAnswers[category] = getProbabilityRange(
        entry.aheadProbability,
      ).id;
    }
    const score = scoreAnswer(answer, highCardAnalysis);
    expect(score.categoryPerfect).toBe(true);
    expect(score.missedCategories).toHaveLength(0);
    expect(score.extraCategories).toHaveLength(0);
  });
});

describe('评分：Hero 是高牌时不要求答「同牌型」', () => {
  const highCardAnalysis = analyzeFlopScenario(scenario('7d 2c', 'Ah Ks 8d'));

  it('前置条件：Hero 高牌，且确实存在同牌型组合', () => {
    expect(highCardAnalysis.sameCategory.category).toBe(HandCategory.HighCard);
    expect(highCardAnalysis.sameCategory.totalCount).toBeGreaterThan(0);
  });

  it('同牌型不计入统计，且默认视为正确', () => {
    const score = scoreAnswer(emptyAnswer(), highCardAnalysis);
    expect(score.sameCategoryTotal).toBe(0);
    expect(score.sameCategoryCorrect).toBe(true);
  });

  it('Hero 是成牌时，仍然要求作答同牌型', () => {
    const pairAnalysis = analyzeFlopScenario(scenario('As Kd', 'Ah 8c 3d'));
    const score = scoreAnswer(emptyAnswer(), pairAnalysis);
    expect(score.sameCategoryTotal).toBe(1);
  });
});

describe('评分：统计累计', () => {
  it('完整答对时连续正确 +1', () => {
    const analysis = analyzeFlopScenario(scenario('As Kd', 'Ah 8c 3d'));
    const answer = emptyAnswer();
    answer.selectedCategories = analysis.byCategory
      .filter((entry) => entry.aheadCount > 0)
      .map((entry) => entry.category);
    for (const category of answer.selectedCategories) {
      const entry = analysis.byCategory.find((i) => i.category === category)!;
      answer.categoryProbabilityAnswers[category] = getProbabilityRange(
        entry.aheadProbability,
      ).id;
    }
    answer.sameCategoryAheadRangeId = getProbabilityRange(
      analysis.sameCategory.aheadConditionalProbability,
    ).id;

    const score = scoreAnswer(answer, analysis);
    const stats = updateTrainerStats(
      {
        totalQuestions: 0,
        categoryPerfectCount: 0,
        categoryRangeCorrect: 0,
        categoryRangeTotal: 0,
        sameCategoryRangeCorrect: 0,
        sameCategoryRangeTotal: 0,
        currentStreak: 0,
      },
      score,
    );
    expect(stats.categoryPerfectCount).toBe(1);
    expect(stats.currentStreak).toBe(1);
  });
});
