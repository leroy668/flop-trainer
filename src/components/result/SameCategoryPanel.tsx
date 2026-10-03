import type { FlopAnalysis } from '../../poker/analyzer';
import { HAND_CATEGORY_LABELS } from '../../poker/evaluator';
import type { ScoreResult } from '../../trainer/scoring';
import { ComboDetails } from '../ComboDetails';
import { CountBadge, Pct } from '../ProbabilityText';
import { rangeLabel, Verdict } from './shared';

interface SameCategoryPanelProps {
  analysis: FlopAnalysis;
  /** 直接看答案（未作答）时为 null。 */
  score: ScoreResult | null;
  /** 本题是否要求判断同牌型（Hero 是高牌时跳过）。 */
  asked: boolean;
}

/** 同牌型内部：与你同牌型的对手里，比你大 / 平 / 小的构成。 */
export function SameCategoryPanel({
  analysis,
  score,
  asked,
}: SameCategoryPanelProps) {
  const total = analysis.totalOpponentCombos;
  const same = analysis.sameCategory;
  const scored = score !== null;

  return (
    <section className="panel">
      <h2>同牌型内部（{HAND_CATEGORY_LABELS[same.category]}）</h2>
      <p className="muted">
        分母为「所有对手最终与你同牌型」的组合数：{same.totalCount}。
      </p>

      {scored && same.totalCount > 0 && !asked && (
        <p className="muted">
          Hero 当前是高牌，本题不要求作答，以下仅为参考数据。
        </p>
      )}

      {same.totalCount === 0 ? (
        <p className="muted">没有对手与你形成相同牌型。</p>
      ) : (
        <>
          <ul className="overall-list">
            <li className="overall-list__item">
              <span className="overall-list__label">
                同牌型总数（{HAND_CATEGORY_LABELS[same.category]}）
              </span>
              <span className="overall-list__value">
                <CountBadge count={same.totalCount} />
              </span>
            </li>
            <li className="overall-list__item overall-list__item--danger">
              <span className="overall-list__label">比你大</span>
              <span className="overall-list__value">
                <span className="overall-list__count">{same.aheadCount} 个</span>
                <Pct
                  value={same.aheadConditionalProbability}
                  tone="danger"
                  size="lg"
                  title="占同牌型手牌"
                />
              </span>
            </li>
            <li className="overall-list__item overall-list__item--tie">
              <span className="overall-list__label">完全相同</span>
              <span className="overall-list__value">
                <span className="overall-list__count">{same.tieCount} 个</span>
                <Pct
                  value={same.tieConditionalProbability}
                  tone="tie"
                  size="lg"
                  title="占同牌型手牌"
                />
              </span>
            </li>
            <li className="overall-list__item overall-list__item--safe">
              <span className="overall-list__label">比你小</span>
              <span className="overall-list__value">
                <span className="overall-list__count">{same.behindCount} 个</span>
                <Pct
                  value={same.behindConditionalProbability}
                  tone="safe"
                  size="lg"
                  title="占同牌型手牌"
                />
              </span>
            </li>
          </ul>

          {score !== null && asked && (
            <div className="answer-line">
              <span>
                你的估计（同牌型条件下比你大）：
                {rangeLabel(score.sameCategoryUserRangeId)}
              </span>
              <Verdict correct={score.sameCategoryCorrect} />
              {!score.sameCategoryCorrect && (
                <span className="muted">
                  实际{' '}
                  <Pct value={same.aheadConditionalProbability} tone="neutral" />，
                  正确区间 {rangeLabel(score.sameCategoryActualRangeId)}
                </span>
              )}
            </div>
          )}

          <h3 className="sub-heading">同牌型中能压过你的具体手牌</h3>
          <p className="muted small">
            同时给出两种概率：占全部随机手牌（/ {total}）与占同牌型手牌（/ {same.totalCount}）。
          </p>
          <ComboDetails
            groups={same.aheadGroups}
            conditionalDenominator={same.totalCount}
            emptyText="没有比你更大的同牌型组合"
          />
        </>
      )}
    </section>
  );
}
