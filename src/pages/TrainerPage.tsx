import { useEffect, useMemo, useState } from 'react';
import { Board } from '../components/Board';
import { HandTypeSelector } from '../components/HandTypeSelector';
import { ProbabilityRangeSelector } from '../components/ProbabilityRangeSelector';
import { ResultBreakdown } from '../components/ResultBreakdown';
import { analyzeFlopScenario } from '../poker/analyzer';
import type { FlopScenario } from '../poker/cards';
import {
  describeHandValue,
  HAND_CATEGORY_LABELS,
  isTrainableCategory,
} from '../poker/evaluator';
import type { HandCategory } from '../poker/evaluator';
import { generateRandomFlopScenario } from '../poker/randomScenario';
import { scoreAnswer, updateTrainerStats } from '../trainer/scoring';
import type { ScoreResult } from '../trainer/scoring';
import { formatPercent } from '../trainer/ranges';
import {
  EMPTY_TRAINER_STATS,
  type TrainerAnswer,
  type TrainerPhase,
  type TrainerStats,
} from '../trainer/types';

const REVEAL_MODE_KEY = 'flop-trainer:reveal-mode';

function readRevealMode(): boolean {
  try {
    return localStorage.getItem(REVEAL_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

function freshAnswer(): TrainerAnswer {
  return { selectedCategories: [], categoryProbabilityAnswers: {} };
}

const STEP_TEXT: Record<TrainerPhase, string> = {
  'answer-categories': '选择压制牌型',
  'answer-category-probabilities': '估计牌型概率',
  'answer-same-category': '同牌型判断',
  result: '结果',
};

export function TrainerPage() {
  const [scenario, setScenario] = useState<FlopScenario>(() =>
    generateRandomFlopScenario(),
  );
  const [phase, setPhase] = useState<TrainerPhase>('answer-categories');
  const [answer, setAnswer] = useState<TrainerAnswer>(freshAnswer);
  const [stats, setStats] = useState<TrainerStats>(EMPTY_TRAINER_STATS);
  const [score, setScore] = useState<ScoreResult | null>(null);
  /** 开关打开时跳过作答，直接展示牌型结果。 */
  const [revealMode, setRevealMode] = useState<boolean>(readRevealMode);

  useEffect(() => {
    try {
      localStorage.setItem(REVEAL_MODE_KEY, revealMode ? '1' : '0');
    } catch {
      // file:// 下可能拿不到 localStorage，忽略即可。
    }
  }, [revealMode]);

  const analysis = useMemo(() => analyzeFlopScenario(scenario), [scenario]);

  const sortedSelected = useMemo(
    () => [...answer.selectedCategories].sort((a, b) => a - b),
    [answer.selectedCategories],
  );

  const allCategoryAnswered = sortedSelected.every(
    (category) => answer.categoryProbabilityAnswers[category] !== undefined,
  );

  // 「同牌型」一题只针对成牌：Hero 是高牌时跳过，题量变为 2 步。
  const sameCategoryAsked =
    analysis.sameCategory.totalCount > 0 &&
    isTrainableCategory(analysis.sameCategory.category);
  const totalSteps = sameCategoryAsked ? 3 : 2;

  const resetForNewHand = () => {
    setScenario(generateRandomFlopScenario());
    setAnswer(freshAnswer());
    setScore(null);
    setPhase('answer-categories');
  };

  const submit = () => {
    const result = scoreAnswer(answer, analysis);
    setScore(result);
    setStats((current) => updateTrainerStats(current, result));
    setPhase('result');
  };

  // 需要「同牌型」题就去答，否则直接提交。
  const goToSameCategoryOrSubmit = () => {
    if (sameCategoryAsked) {
      setPhase('answer-same-category');
    } else {
      submit();
    }
  };

  const confirmCategories = () => {
    if (sortedSelected.length > 0) {
      setPhase('answer-category-probabilities');
    } else {
      goToSameCategoryOrSubmit();
    }
  };

  const confirmCategoryProbabilities = () => {
    if (!allCategoryAnswered) return;
    goToSameCategoryOrSubmit();
  };

  const setSelectedCategories = (next: HandCategory[]) => {
    setAnswer((current) => ({ ...current, selectedCategories: next }));
  };

  const setCategoryRange = (category: HandCategory, rangeId: string) => {
    setAnswer((current) => ({
      ...current,
      categoryProbabilityAnswers: {
        ...current.categoryProbabilityAnswers,
        [category]: rangeId,
      },
    }));
  };

  const setSameCategoryRange = (rangeId: string) => {
    setAnswer((current) => ({ ...current, sameCategoryAheadRangeId: rangeId }));
  };

  const categoryAccuracy =
    stats.totalQuestions > 0
      ? stats.categoryPerfectCount / stats.totalQuestions
      : 0;
  const rangeAccuracy =
    stats.categoryRangeTotal > 0
      ? stats.categoryRangeCorrect / stats.categoryRangeTotal
      : 0;
  const sameAccuracy =
    stats.sameCategoryRangeTotal > 0
      ? stats.sameCategoryRangeCorrect / stats.sameCategoryRangeTotal
      : 0;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>翻牌圈相对牌力训练器</h1>
          <p className="muted">
            对手从剩余 47 张未知牌中随机获得 2 张，共 1081 个等权组合。
          </p>
        </div>
        <div className="page__header-actions">
          <label className="switch">
            <input
              type="checkbox"
              checked={revealMode}
              onChange={(event) => setRevealMode(event.target.checked)}
            />
            <span className="switch__track">
              <span className="switch__thumb" />
            </span>
            <span className="switch__label">直接看答案</span>
          </label>
          <button
            type="button"
            className="button button--ghost"
            onClick={resetForNewHand}
          >
            换一题
          </button>
        </div>
      </header>

      <section className="stats">
        <div className="stat">
          <span className="stat__label">牌型判断正确率</span>
          <strong>{formatPercent(categoryAccuracy)}</strong>
          <span className="muted small">
            {stats.categoryPerfectCount} / {stats.totalQuestions}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">概率区间正确率</span>
          <strong>{formatPercent(rangeAccuracy)}</strong>
          <span className="muted small">
            {stats.categoryRangeCorrect} / {stats.categoryRangeTotal}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">同牌型判断正确率</span>
          <strong>{formatPercent(sameAccuracy)}</strong>
          <span className="muted small">
            {stats.sameCategoryRangeCorrect} / {stats.sameCategoryRangeTotal}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">连续正确</span>
          <strong>{stats.currentStreak}</strong>
        </div>
      </section>

      <section className="panel">
        <Board scenario={scenario} />
        <p className="hero-type">
          当前牌型：<strong>{describeHandValue(analysis.heroHandValue)}</strong>
        </p>
      </section>

      {revealMode ? (
        <>
          <p className="reveal-note">
            直接看答案模式：已跳过牌型选择与概率估计，不计入统计。
          </p>
          <ResultBreakdown analysis={analysis} score={null} answer={answer} />
          <div className="actions actions--sticky">
            <button type="button" className="button" onClick={resetForNewHand}>
              下一题
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="steps">
        <span className={`steps__item ${phase === 'answer-categories' ? 'is-active' : ''}`}>
          1 / {totalSteps} {STEP_TEXT['answer-categories']}
        </span>
        <span
          className={`steps__item ${
            phase === 'answer-category-probabilities' ? 'is-active' : ''
          }`}
        >
          2 / {totalSteps} {STEP_TEXT['answer-category-probabilities']}
        </span>
        {sameCategoryAsked && (
          <span
            className={`steps__item ${
              phase === 'answer-same-category' ? 'is-active' : ''
            }`}
          >
            {totalSteps} / {totalSteps} {STEP_TEXT['answer-same-category']}
          </span>
        )}
        <span className={`steps__item ${phase === 'result' ? 'is-active' : ''}`}>
          {STEP_TEXT.result}
        </span>
      </div>

      {phase === 'answer-categories' && (
        <section className="panel">
          <h2>哪些牌型类别中存在能压过你的对手手牌？</h2>
          <p className="muted">
            可多选。注意：同牌型中如果有比你更大的组合，也算正确答案。
          </p>
          <HandTypeSelector value={sortedSelected} onChange={setSelectedCategories} />
          <div className="actions">
            <button type="button" className="button" onClick={confirmCategories}>
              确认牌型
            </button>
          </div>
        </section>
      )}

      {phase === 'answer-category-probabilities' && (
        <section className="panel">
          <h2>这些牌型能压过你的概率大约是多少？</h2>
          <p className="muted">
            概率 = 该牌型领先组合数 / 1081，即「占全部随机两张手牌」的概率。
          </p>
          {sortedSelected.map((category) => (
            <div className="category-block" key={category}>
              <h3>{HAND_CATEGORY_LABELS[category]}且压过你的概率</h3>
              <ProbabilityRangeSelector
                name={`category-${category}`}
                value={answer.categoryProbabilityAnswers[category]}
                onChange={(rangeId) => setCategoryRange(category, rangeId)}
              />
            </div>
          ))}
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={!allCategoryAnswered}
              onClick={confirmCategoryProbabilities}
            >
              {sameCategoryAsked ? '下一步：同牌型' : '提交并揭晓'}
            </button>
            {!allCategoryAnswered && (
              <span className="muted small">请为每个已选牌型选择一个区间。</span>
            )}
          </div>
        </section>
      )}

      {phase === 'answer-same-category' && (
        <section className="panel">
          <h2>
            如果对手与你形成相同牌型（
            {HAND_CATEGORY_LABELS[analysis.sameCategory.category]}），
            其中比你大的概率大约是多少？
          </h2>
          <p className="muted">
            这里使用条件概率：同牌型中比你大的组合数 / 所有同牌型组合数，
            不是占 1081 的比例。
          </p>
          <ProbabilityRangeSelector
            name="same-category"
            value={answer.sameCategoryAheadRangeId}
            onChange={setSameCategoryRange}
          />
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={answer.sameCategoryAheadRangeId === undefined}
              onClick={submit}
            >
              提交并揭晓
            </button>
            {answer.sameCategoryAheadRangeId === undefined && (
              <span className="muted small">请选择一个区间。</span>
            )}
          </div>
        </section>
      )}

      {phase === 'result' && score && (
        <>
          <ResultBreakdown analysis={analysis} score={score} answer={answer} />
          <div className="actions actions--sticky">
            <button type="button" className="button" onClick={resetForNewHand}>
              下一题
            </button>
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
}
