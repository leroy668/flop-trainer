import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Board } from '../components/Board';
import { HandTypeSelector } from '../components/HandTypeSelector';
import { ProbabilityRangeSelector } from '../components/ProbabilityRangeSelector';
import { ResultBreakdown } from '../components/ResultBreakdown';
import { analyzeScenario } from '../poker/analyzer';
import type { Scenario, Street } from '../poker/cards';
import { STREET_CARD_LABELS, STREET_LABELS, streetOf } from '../poker/cards';
import {
  describeHandValue,
  HAND_CATEGORY_LABELS,
  isTrainableCategory,
} from '../poker/evaluator';
import type { HandCategory } from '../poker/evaluator';
import { dealNextStreet, generateRandomScenario } from '../poker/randomScenario';
import { scoreAnswer, updateTrainerStats } from '../trainer/scoring';
import type { ScoreResult } from '../trainer/scoring';
import {
  popStreetSnapshot,
  previousStreetOf,
  pushStreetSnapshot,
} from '../trainer/streetHistory';
import type { StreetSnapshot } from '../trainer/streetHistory';
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

/** 发牌前的快照：收回上一街时连作答与结果一起恢复。 */

export function TrainerPage() {
  const [scenario, setScenario] = useState<Scenario>(() =>
    generateRandomScenario(),
  );
  const [phase, setPhase] = useState<TrainerPhase>('answer-categories');
  const [answer, setAnswer] = useState<TrainerAnswer>(freshAnswer);
  const [stats, setStats] = useState<TrainerStats>(EMPTY_TRAINER_STATS);
  const [score, setScore] = useState<ScoreResult | null>(null);
  /** 开关打开时跳过作答，直接展示牌型结果。 */
  const [revealMode, setRevealMode] = useState<boolean>(readRevealMode);
  /** 已经发出去的公共牌：每发一街压一份快照，可以逐街退回去。 */
  const [dealtHistory, setDealtHistory] = useState<StreetSnapshot[]>([]);
  /** 刚发下来的那条街（用于高亮），退回去或换题后清空。 */
  const [justDealt, setJustDealt] = useState<Street | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(REVEAL_MODE_KEY, revealMode ? '1' : '0');
    } catch {
      // file:// 下可能拿不到 localStorage，忽略即可。
    }
  }, [revealMode]);

  const analysis = useMemo(() => analyzeScenario(scenario), [scenario]);
  const street = streetOf(scenario);
  const totalOpponentCombos = analysis.totalOpponentCombos;
  const nextStreetLabel = street === 'flop' ? '发转牌' : '发河牌';
  const cardLabel = STREET_CARD_LABELS[street];

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
    setScenario(generateRandomScenario());
    setAnswer(freshAnswer());
    setScore(null);
    setPhase('answer-categories');
    setDealtHistory([]);
    setJustDealt(null);
  };

  /** 发下一条街（翻牌 -> 转牌 -> 河牌），新的一圈就是新的一题。 */
  const dealNext = () => {
    if (street === 'river') return;
    const nextScenario = dealNextStreet(scenario);
    setDealtHistory((stack) =>
      pushStreetSnapshot(stack, { scenario, phase, answer, score }),
    );
    setScenario(nextScenario);
    setAnswer(freshAnswer());
    setScore(null);
    setPhase('answer-categories');
    setJustDealt(streetOf(nextScenario));
  };

  /** 收回最近发出的那条街，回到发牌之前（作答与结果一并恢复）。 */
  const undoStreet = () => {
    const popped = popStreetSnapshot(dealtHistory);
    if (!popped) return;
    setDealtHistory(popped.rest);
    setScenario(popped.snapshot.scenario);
    setAnswer(popped.snapshot.answer);
    setScore(popped.snapshot.score);
    setPhase(popped.snapshot.phase);
    setJustDealt(null);
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

  /** 「收回转牌 / 收回河牌」按钮：只在已经发过牌时出现。 */
  const previousStreet = previousStreetOf(dealtHistory);
  const previousStreetLabel =
    previousStreet === null ? null : STREET_LABELS[previousStreet];
  const previousCardLabel =
    previousStreet === null ? null : STREET_CARD_LABELS[previousStreet];
  const undoButton =
    previousStreetLabel === null ? null : (
      <button
        type="button"
        className="button button--ghost"
        onClick={undoStreet}
        title={`收回${cardLabel}，恢复${previousStreetLabel}的牌面、作答与结果`}
      >
        ↩ 回到{previousStreetLabel}
      </button>
    );

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

  /** 结果页（含直接看答案）底部的操作：发下一条街 / 收回 / 换一手牌。 */
  const streetActions = (
    <div className="actions actions--sticky">
      {street !== 'river' && (
        <button type="button" className="button" onClick={dealNext}>
          {nextStreetLabel} ▶
        </button>
      )}
      <button
        type="button"
        className={`button ${street === 'river' ? '' : 'button--ghost'}`}
        onClick={resetForNewHand}
      >
        下一题
      </button>
      {undoButton}
      <span className="muted small">
        {street === 'river'
          ? '河牌已发完，换一手新牌'
          : `${nextStreetLabel}后按新牌面重新出题`}
      </span>
    </div>
  );

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>德州扑克相对牌力训练器</h1>
          <p className="muted">
            {STREET_LABELS[street]}：对手从剩余 {analysis.remainingCount}{' '}
            张未知牌中随机获得 2 张，共 {totalOpponentCombos} 个等权组合。
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
          <Link className="button button--ghost" to="/flop-types">
            翻牌牌型图鉴
          </Link>
          <Link className="button button--ghost" to="/board-textures">
            牌面结构图鉴
          </Link>
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
        <Board scenario={scenario} highlightStreet={justDealt} />
        <p className="hero-type">
          <span className="street-badge">{STREET_LABELS[street]}</span>
          当前牌型：<strong>{describeHandValue(analysis.heroHandValue)}</strong>
          <span className="muted small">
            （{analysis.remainingBoardCards > 0
              ? `还剩 ${analysis.remainingBoardCards} 张公共牌`
              : '公共牌已发完'}
            ）
          </span>
        </p>
        {previousCardLabel !== null && !revealMode && phase !== 'result' && (
          <div className="street-undo">
            {undoButton}
            <span className="muted small">
              收回{cardLabel}，回到{previousCardLabel}继续
            </span>
          </div>
        )}
      </section>

      {revealMode ? (
        <>
          <p className="reveal-note">
            直接看答案模式：已跳过牌型选择与概率估计，不计入统计。
          </p>
          <ResultBreakdown analysis={analysis} score={null} answer={answer} />
          {streetActions}
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
            概率 = 该牌型领先组合数 / {totalOpponentCombos}，即「占全部随机两张手牌」的概率。
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
            不是占 {totalOpponentCombos} 的比例。
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
          {streetActions}
        </>
      )}
        </>
      )}
    </div>
  );
}
