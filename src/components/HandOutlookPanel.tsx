import { useMemo } from 'react';
import type { Scenario } from '../poker/cards';
import type { FiveCardSummary } from '../poker/handType';
import { analyzeHeroOutlook } from '../poker/outlook';
import { CountBadge, Pct } from './ProbabilityText';

interface HandOutlookPanelProps {
  scenario: Scenario;
  /** 已经算好的「当前 5 张牌归类」，由结果页统一算一次。 */
  summary: FiveCardSummary;
}

/** 当前 5 张牌的归类名 + 组成。 */
function HandTypeBlock({ summary }: { summary: FiveCardSummary }) {
  return (
    <div className={`hand-type hand-type--${summary.kind}`}>
      <div className="hand-type__head">
        <span className="hand-type__summary">{summary.summary}</span>
        {summary.comboDraw && <span className="hand-type__tag">双听牌</span>}
      </div>
      <p className="hand-type__detail">
        已成牌：{summary.madeHand}（{summary.detail}）
      </p>
      {summary.draws.length === 0 ? (
        <p className="hand-type__detail muted">没有顺子 / 同花听牌</p>
      ) : (
        <ul className="hand-type__draws">
          {summary.draws.map((draw) => (
            <li className="hand-type__draw" key={draw.label}>
              <span className="hand-type__draw-label">{draw.label}</span>
              <span className="hand-type__draw-outs">
                {draw.backdoor ? '需连来两张' : `补牌 ${draw.outs} 张`}
              </span>
              {draw.backdoor ? (
                <Pct
                  value={draw.finalProbability}
                  tone="danger"
                  size="md"
                  title="发完剩余公共牌前补成"
                />
              ) : (
                <>
                  <Pct
                    value={draw.nextProbability}
                    tone="neutral"
                    size="md"
                    title="下一张公共牌就补成"
                  />
                  <Pct
                    value={draw.finalProbability}
                    tone="danger"
                    size="md"
                    title="发完剩余公共牌前补成"
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 「当前 5 张牌」分析面板：先把牌面归类成一句类型（顶对 + 同花听牌 ♠），
 * 再把后续公共牌全部枚举，统计最终牌型的分布。
 *
 * 只在结果阶段（含「直接看答案」）渲染，所以耗时的后续枚举
 * （翻牌圈 1081 个等权后续）也只在切到这个选项卡时才计算。
 */
export function HandOutlookPanel({ scenario, summary }: HandOutlookPanelProps) {
  const outlook = useMemo(() => analyzeHeroOutlook(scenario), [scenario]);

  return (
    <section className="panel">
      <h2>当前 5 张牌</h2>
      <HandTypeBlock summary={summary} />

      {outlook.remainingBoardCards === 0 ? (
        <p className="muted small">
          公共牌已经发完，牌型已经定型，没有后续牌可以再补了。
        </p>
      ) : (
        <>
          <h3 className="sub-heading">
            发完后你的最终牌型（{outlook.total} 个等权后续）
          </h3>
          <p className="muted small">
            {outlook.remainingBoardCards >= 2
              ? '接下来还要发两张公共牌，把剩余未知牌里的所有取法都枚举一遍：'
              : '接下来只剩一张公共牌，逐张枚举：'}
            每一个后续都按「7 张取最优五张」评价，所以最终牌型只可能变强。
          </p>
          <ul className="outlook-list">
            {outlook.rows.map((row) => (
              <li
                className={`outlook-row ${row.change === 'improve' ? 'outlook-row--improve' : ''}`}
                key={row.category}
              >
                <span className="outlook-row__label">
                  {row.label}
                  <span className="outlook-row__tag">
                    {row.change === 'improve' ? '提升' : '保持'}
                  </span>
                </span>
                <span className="outlook-row__count">
                  <CountBadge count={row.count} />
                </span>
                <Pct
                  value={row.probability}
                  tone={row.change === 'improve' ? 'danger' : 'neutral'}
                  size="md"
                />
              </li>
            ))}
          </ul>

          <div className="outlook-summary">
            <span className="outlook-summary__label">最终强于现在的概率</span>
            <Pct value={outlook.improveProbability} tone="danger" size="lg" />
            <span className="muted small">
              （{outlook.improveCount} / {outlook.total} 个后续）
            </span>
          </div>

          {outlook.bestCategory === null ? (
            <p className="muted small">这个牌面已经没有更高级的牌型可以补了。</p>
          ) : (
            <p className="muted small">
              最高能补成 {outlook.bestLabel}：{outlook.bestCount} 个组合，
              <Pct value={outlook.bestProbability} tone="neutral" size="md" />
              。
            </p>
          )}
        </>
      )}
    </section>
  );
}
