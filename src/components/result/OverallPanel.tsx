import type { ScenarioAnalysis } from '../../poker/analyzer';
import { HAND_CATEGORY_LABELS } from '../../poker/evaluator';
import { Pct } from '../ProbabilityText';

interface OverallPanelProps {
  analysis: ScenarioAnalysis;
}

/** 总体牌力：领先 / 平手 / 落后，以及领先牌型构成。 */
export function OverallPanel({ analysis }: OverallPanelProps) {
  const total = analysis.totalOpponentCombos;
  const beatingCategories = analysis.byCategory.filter(
    (entry) => entry.aheadCount > 0,
  );

  return (
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
  );
}
