import type { FlopAnalysis } from '../poker/analyzer';
import {
  HAND_CATEGORY_LABELS,
  isTrainableCategory,
} from '../poker/evaluator';
import type { ScoreResult } from '../trainer/scoring';
import { getProbabilityRangeById } from '../trainer/ranges';
import type { TrainerAnswer } from '../trainer/types';
import { ComboDetails } from './ComboDetails';
import { CountBadge, Pct } from './ProbabilityText';

interface ResultBreakdownProps {
  analysis: FlopAnalysis;
  /** 直接看答案（未作答）时为 null，此时隐藏所有对错与作答相关信息。 */
  score: ScoreResult | null;
  answer: TrainerAnswer;
}

function rangeLabel(id?: string): string {
  if (!id) return '未作答';
  return getProbabilityRangeById(id)?.label ?? id;
}

function Verdict({ correct }: { correct: boolean }) {
  return (
    <span className={`verdict ${correct ? 'verdict--ok' : 'verdict--bad'}`}>
      {correct ? '✓ 正确' : '✗ 错误'}
    </span>
  );
}

export function ResultBreakdown({
  analysis,
  score,
  answer,
}: ResultBreakdownProps) {
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
  const same = analysis.sameCategory;
  const scored = score !== null;
  const sameCategoryAsked = scored
    ? score.sameCategoryTotal > 0
    : same.totalCount > 0 && isTrainableCategory(same.category);

  return (
    <div className="result">
      <section className="panel">
        <h2>总体牌力</h2>
        <p className="muted">分母为全部 {total} 个随机对手手牌组合。</p>

        <div
          className="prob-bar"
          role="img"
          aria-label={`对手领先 ${(analysis.aheadProbability * 100).toFixed(2)}%，平手 ${(
            analysis.tieProbability * 100
          ).toFixed(2)}%，你领先 ${(analysis.behindProbability * 100).toFixed(2)}%`}
        >
          <span
            className="prob-bar__seg prob-bar__seg--danger"
            style={{ width: `${analysis.aheadProbability * 100}%` }}
          />
          <span
            className="prob-bar__seg prob-bar__seg--tie"
            style={{ width: `${analysis.tieProbability * 100}%` }}
          />
          <span
            className="prob-bar__seg prob-bar__seg--safe"
            style={{ width: `${analysis.behindProbability * 100}%` }}
          />
        </div>

        <ul className="overall-list">
          <li className="overall-list__item overall-list__item--danger overall-list__item--stack">
            <div className="overall-list__row">
              <span className="overall-list__label">对手领先</span>
              <span className="overall-list__value">
                <span className="overall-list__count">
                  {analysis.aheadCount} / {total}
                </span>
                <Pct value={analysis.aheadProbability} tone="danger" size="lg" />
              </span>
            </div>
            {beatingCategories.length > 0 && (
              <div className="beating-summary">
                <span className="beating-summary__title">
                  领先牌型构成
                  <span className="beating-summary__hint">
                    红色 = 占全部随机手牌；蓝色 = 占该牌型总数
                  </span>
                </span>
                <ul className="beating-summary__list">
                  {beatingCategories.map((entry) => (
                    <li key={entry.category}>
                      <span className="beating-summary__label">
                        {HAND_CATEGORY_LABELS[entry.category]}
                      </span>
                      <span className="beating-summary__count">
                        {entry.aheadCount} 个组合 / {total}
                      </span>
                      <Pct
                        value={entry.aheadProbability}
                        tone="danger"
                        size="md"
                        title="该牌型占全部随机手牌的概率"
                      />
                      {entry.totalCount > 0 ? (
                        <span
                          className="beating-summary__cond"
                          title={`同牌型共 ${entry.totalCount} 个组合，其中 ${entry.aheadCount} 个能压过你（${entry.aheadCount} / ${entry.totalCount}）`}
                        >
                          占同牌型{' '}
                          <Pct
                            value={entry.aheadCount / entry.totalCount}
                            tone="neutral"
                            size="md"
                          />
                        </span>
                      ) : null}
                    </li>
                  ))}
                  <li className="beating-summary__total">
                    <span className="beating-summary__label">合计</span>
                    <span className="beating-summary__count">
                      {analysis.aheadCount} 个组合 / {total}
                    </span>
                    <Pct value={analysis.aheadProbability} tone="danger" size="md" />
                  </li>
                </ul>
              </div>
            )}
          </li>
          <li className="overall-list__item overall-list__item--tie">
            <span className="overall-list__label">完全平手</span>
            <span className="overall-list__value">
              <span className="overall-list__count">
                {analysis.tieCount} / {total}
              </span>
              <Pct value={analysis.tieProbability} tone="tie" size="lg" />
            </span>
          </li>
          <li className="overall-list__item overall-list__item--safe">
            <span className="overall-list__label">你领先</span>
            <span className="overall-list__value">
              <span className="overall-list__count">
                {analysis.behindCount} / {total}
              </span>
              <Pct value={analysis.behindProbability} tone="safe" size="lg" />
            </span>
          </li>
        </ul>
        <p className="muted small">
          {analysis.aheadCount} + {analysis.tieCount} + {analysis.behindCount} = {total}
        </p>
      </section>

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
                  <span>
                    你的估计：{rangeLabel(rangeScore?.userRangeId)}
                  </span>
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
                const total = entry?.totalCount ?? 0;
                return (
                  <li key={category}>
                    <span className="extra-categories__name">{label}</span>
                    <span className="muted">
                      {total === 0
                        ? `本翻牌面下不可能出现：对手 2 张手牌无法与翻牌组成${label}`
                        : `本牌面共有 ${total} 个${label}组合，但都没有压过你`}
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
      </section>

      <section className="panel">
        <h2>同牌型内部（{HAND_CATEGORY_LABELS[same.category]}）</h2>
        <p className="muted">
          分母为「所有对手最终与你同牌型」的组合数：{same.totalCount}。
        </p>

        {scored && same.totalCount > 0 && !sameCategoryAsked && (
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

            {score !== null && sameCategoryAsked && (
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

      {scored && answer.selectedCategories.length === 0 && (
        <p className="muted small">本题你未选择任何牌型。</p>
      )}
    </div>
  );
}
