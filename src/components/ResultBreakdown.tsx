import { useState } from 'react';
import type { FlopAnalysis } from '../poker/analyzer';
import { HAND_CATEGORY_LABELS, isTrainableCategory } from '../poker/evaluator';
import { formatPercent } from '../trainer/ranges';
import type { ScoreResult } from '../trainer/scoring';
import type { TrainerAnswer } from '../trainer/types';
import { DrawAnalysisPanel } from './DrawAnalysisPanel';
import { BeatingPanel } from './result/BeatingPanel';
import { OverallPanel } from './result/OverallPanel';
import { SameCategoryPanel } from './result/SameCategoryPanel';

interface ResultBreakdownProps {
  analysis: FlopAnalysis;
  /** 直接看答案（未作答）时为 null，此时隐藏所有对错与作答相关信息。 */
  score: ScoreResult | null;
  answer: TrainerAnswer;
}

type ResultTabId = 'overall' | 'beating' | 'same' | 'draws';

interface ResultTab {
  id: ResultTabId;
  /** 桌面端的选项卡标题。 */
  label: string;
  /** 手机端的短标题（窄屏放不下长标题）。 */
  short: string;
  /** 选项卡上的摘要数字，方便不切换也能扫一眼。 */
  hint: string;
  /** 作答对错标记（只有作答后才有）。 */
  flag?: 'ok' | 'bad';
}

/**
 * 结果页。四块内容做成选项卡，一次只渲染一块，避免一路往下滚。
 * 每块在选项卡上带一个摘要数字（和作答对错标记）。
 */
export function ResultBreakdown({
  analysis,
  score,
  answer,
}: ResultBreakdownProps) {
  const [active, setActive] = useState<ResultTabId>('overall');

  const total = analysis.totalOpponentCombos;
  const beatingCategories = analysis.byCategory.filter(
    (entry) => entry.aheadCount > 0,
  );
  const same = analysis.sameCategory;
  const scored = score !== null;
  const sameCategoryAsked = scored
    ? score.sameCategoryTotal > 0
    : same.totalCount > 0 && isTrainableCategory(same.category);

  const categoryMistake =
    scored &&
    (score.extraCategories.length > 0 || score.missedCategories.length > 0);

  const tabs: ResultTab[] = [
    {
      id: 'overall',
      label: '总体牌力',
      short: '总体牌力',
      hint: `对手领先 ${formatPercent(analysis.aheadProbability)}`,
    },
    {
      id: 'beating',
      label: '能压过你的牌型',
      short: '压制牌型',
      hint:
        beatingCategories.length === 0
          ? '没有'
          : `${beatingCategories.length} 种 · ${analysis.aheadCount} / ${total}`,
      flag: scored ? (categoryMistake ? 'bad' : 'ok') : undefined,
    },
    {
      id: 'same',
      label: `同牌型内部（${HAND_CATEGORY_LABELS[same.category]}）`,
      short: `同牌型（${HAND_CATEGORY_LABELS[same.category]}）`,
      hint:
        same.totalCount === 0
          ? '没有同牌型组合'
          : `${same.totalCount} 个 · 比你大 ${formatPercent(same.aheadConditionalProbability)}`,
      flag:
        scored && sameCategoryAsked
          ? score.sameCategoryCorrect
            ? 'ok'
            : 'bad'
          : undefined,
    },
    {
      id: 'draws',
      label: '后续听牌（转牌 / 河牌）',
      short: '后续听牌',
      hint: '顺子 / 同花能补成多少',
    },
  ];

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className="result">
      {score !== null && (
        <ul className="result-summary">
          <li className={score.categoryPerfect ? 'is-ok' : 'is-bad'}>
            牌型判断 {score.categoryPerfect ? '✓ 正确' : '✗ 错误'}
          </li>
          <li
            className={
              score.categoryRangeCorrect === score.categoryRangeTotal
                ? 'is-ok'
                : 'is-bad'
            }
          >
            概率区间 {score.categoryRangeCorrect} / {score.categoryRangeTotal} 对
          </li>
          {score.sameCategoryTotal > 0 && (
            <li className={score.sameCategoryCorrect ? 'is-ok' : 'is-bad'}>
              同牌型判断 {score.sameCategoryCorrect ? '✓ 正确' : '✗ 错误'}
            </li>
          )}
        </ul>
      )}

      {/*
       * 用「一组开关」的语义（而不是 tablist）：面板是切一个才渲染一个的，
       * 这样不用额外实现方向键导航，屏幕阅读器也不会以为有隐藏面板。
       */}
      <div className="result-tabs" role="group" aria-label="结果分类">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={tab.id === current.id}
            className={[
              'result-tab',
              tab.id === current.id ? 'is-active' : '',
              tab.flag ? `result-tab--${tab.flag}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setActive(tab.id)}
          >
            <span className="result-tab__label">
              <span className="result-tab__text result-tab__text--long">
                {tab.label}
              </span>
              <span className="result-tab__text result-tab__text--short">
                {tab.short}
              </span>
            </span>
            <span className="result-tab__hint">
              {tab.flag ? (tab.flag === 'ok' ? '✓ ' : '✗ ') : ''}
              {tab.hint}
            </span>
          </button>
        ))}
      </div>

      <div className="result-panel" aria-label={current.label}>
        {current.id === 'overall' && <OverallPanel analysis={analysis} />}
        {current.id === 'beating' && (
          <BeatingPanel analysis={analysis} score={score} answer={answer} />
        )}
        {current.id === 'same' && (
          <SameCategoryPanel
            analysis={analysis}
            score={score}
            asked={sameCategoryAsked}
          />
        )}
        {/* 听牌枚举放在这里，只有切换到该选项卡时才计算。 */}
        {current.id === 'draws' && <DrawAnalysisPanel scenario={analysis.scenario} />}
      </div>
    </div>
  );
}
