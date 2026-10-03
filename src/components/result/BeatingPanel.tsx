import type { FlopAnalysis } from '../../poker/analyzer';
import {
  HAND_CATEGORY_LABELS,
  isTrainableCategory,
} from '../../poker/evaluator';
import type { ScoreResult } from '../../trainer/scoring';
import type { TrainerAnswer } from '../../trainer/types';
import { ComboDetails } from '../ComboDetails';
import { CountBadge, Pct } from '../ProbabilityText';
import { rangeLabel, Verdict } from './shared';

interface BeatingPanelProps {
  analysis: FlopAnalysis;
  /** 直接看答案（未作答）时为 null。 */
  score: ScoreResult | null;
  answer: TrainerAnswer;
}

/** 能压过你的牌型（含误判 / 漏选提示）。 */
export function BeatingPanel({ analysis, score, answer }: BeatingPanelProps) {
  const total = analysis.totalOpponentCombos;
  const beatingCategories = analysis.byCategory.filter(
    (entry) => entry.aheadCount > 0,
  );
  // 「高牌」不要求作答，仅作为参考展示。
  const trainableBeating = beatingCategories.filter((entry) =>
    isTrainableCategory(entry.category),
  );
  const excludedBeating = beatingCategories.filter(
    (entry) => !isTrainableCategory(entry.category),
  );
  const scored = score !== null;

  return (
    <section className="panel">
      <h2>能压过你的牌型</h2>
      <p className="muted">
        概率为「占全部随机两张手牌」：该牌型领先组合数 / {total}。
      </p>

      {beatingCategories.length === 0 && (
        <p className="muted">当前牌面下没有任何对手组合能压过你。</p>
      )}

      {trainableBeating.map((entry) => {
        const rangeScore = score?.categoryRangeScores.find(
          (item) => item.category === entry.category,
        );
        return (
          <div className="category-block" key={entry.category}>
            <div className="category-block__head">
              <h3>{HAND_CATEGORY_LABELS[entry.category]}</h3>
              <span className="category-block__numbers">
                <CountBadge count={entry.aheadCount} />
                <Pct
                  value={entry.aheadProbability}
                  tone="danger"
                  size="lg"
                  title="占全部随机手牌"
                />
              </span>
            </div>
            {scored && (
              <div className="answer-line">
                <span>你的估计：{rangeLabel(rangeScore?.userRangeId)}</span>
                {rangeScore && (
                  <>
                    <Verdict correct={rangeScore.rangeCorrect} />
                    {!rangeScore.rangeCorrect && (
                      <span className="muted">
                        实际 <Pct value={entry.aheadProbability} tone="neutral" />，
                        正确区间 {rangeLabel(rangeScore.correctRangeId)}
                      </span>
                    )}
                  </>
                )}
                {rangeScore?.userRangeId === undefined && (
                  <span className="muted">未选择该牌型</span>
                )}
              </div>
            )}
            <ComboDetails groups={entry.groups} emptyText="没有领先组合" />
          </div>
        );
      })}

      {excludedBeating.map((entry) => (
        <p className="muted small" key={`excluded-${entry.category}`}>
          {HAND_CATEGORY_LABELS[entry.category]}
          不要求作答，仅供参考：{entry.aheadCount} 个组合能压过你（占全部{' '}
          <Pct value={entry.aheadProbability} tone="neutral" />）。
        </p>
      ))}

      {score !== null && score.extraCategories.length > 0 && (
        <div className="category-block category-block--warn">
          <h3>误判：你选择了以下牌型，但它们没有能压过你的组合</h3>
          <ul className="extra-categories">
            {score.extraCategories.map((category) => {
              const entry = analysis.byCategory.find(
                (item) => item.category === category,
              );
              const label = HAND_CATEGORY_LABELS[category];
              const categoryTotal = entry?.totalCount ?? 0;
              return (
                <li key={category}>
                  <span className="extra-categories__name">{label}</span>
                  <span className="muted">
                    {categoryTotal === 0
                      ? `本翻牌面下不可能出现：对手 2 张手牌无法与翻牌组成${label}`
                      : `本牌面共有 ${categoryTotal} 个${label}组合，但都没有压过你`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {score !== null && score.missedCategories.length > 0 && (
        <p className="muted">
          漏选牌型：
          {score.missedCategories
            .map((category) => HAND_CATEGORY_LABELS[category])
            .join('、')}
        </p>
      )}

      {score !== null && answer.selectedCategories.length === 0 && (
        <p className="muted small">本题你未选择任何牌型。</p>
      )}
    </section>
  );
}
