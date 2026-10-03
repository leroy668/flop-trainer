import { useMemo } from 'react';
import type { Scenario } from '../poker/cards';
import { cardToString, isRedSuit } from '../poker/cards';
import type { DrawCompletion, OpponentDrawRow } from '../poker/draws';
import { analyzeDraws } from '../poker/draws';
import { CountBadge, Pct } from './ProbabilityText';

interface DrawAnalysisPanelProps {
  scenario: Scenario;
}

/** 「下一张牌」在不同圈的名称：翻牌后是转牌，转牌后是河牌。 */
function nextStreetName(remainingBoardCards: number): string {
  return remainingBoardCards >= 2 ? '转牌' : '河牌';
}

function OutChips({ completion }: { completion: DrawCompletion }) {
  if (completion.outs.length === 0) return null;
  return (
    <span className="draw__outs">
      {completion.outs.map((card) => (
        <span
          className={`draw__out ${isRedSuit(card.suit) ? 'draw__out--red' : ''}`}
          key={cardToString(card)}
        >
          {cardToString(card)}
        </span>
      ))}
    </span>
  );
}

function CompletionStats({
  completion,
  remainingBoardCards,
}: {
  completion: DrawCompletion;
  remainingBoardCards: number;
}) {
  // 只剩一张牌可发时，「下一张」与「发完」是同一批牌，只显示一列。
  const showFinal = remainingBoardCards >= 2;
  return (
    <span className="draw__stats">
      <span className="draw__stat">
        <span className="draw__stat-key">
          {nextStreetName(remainingBoardCards)}
        </span>
        <span className="draw__frac">
          {completion.nextCount} / {completion.nextTotal}
        </span>
        <Pct value={completion.nextProbability} tone="neutral" size="md" />
      </span>
      {showFinal && (
        <span className="draw__stat">
          <span className="draw__stat-key">到河牌</span>
          <span className="draw__frac">
            {completion.finalCount} / {completion.finalTotal}
          </span>
          <Pct value={completion.finalProbability} tone="danger" size="md" />
        </span>
      )}
    </span>
  );
}

function OpponentRow({
  row,
  remainingBoardCards,
}: {
  row: OpponentDrawRow;
  remainingBoardCards: number;
}) {
  const nextName = nextStreetName(remainingBoardCards);
  return (
    <li className="draw-table__row">
      <span className="draw-table__label">{row.label}</span>
      <span className="draw-table__cell" data-label="组合数 / 占比">
        <CountBadge count={row.comboCount} />
        <Pct value={row.probability} tone="danger" size="md" />
      </span>
      <span className="draw-table__cell" data-label={`${nextName}补成（平均）`}>
        <Pct value={row.averageNextProbability} tone="neutral" size="md" />
      </span>
      {remainingBoardCards >= 2 && (
        <span className="draw-table__cell" data-label="到河牌补成（平均）">
          <Pct value={row.averageFinalProbability} tone="neutral" size="md" />
        </span>
      )}
      <span className="draw-table__cell" data-label="拿到且补成">
        <Pct value={row.jointFinalProbability} tone="info" size="md" />
      </span>
    </li>
  );
}

/**
 * 后续听牌分析面板。
 *
 * 只在结果阶段（含「直接看答案」）渲染，因此耗时的对手侧枚举
 * 也只在结果出现时才算，答题过程不受影响。
 * 转牌圈只剩一张河牌，所以「下一张」与「发完」合并成一列。
 */
export function DrawAnalysisPanel({ scenario }: DrawAnalysisPanelProps) {
  const { hero, opponent } = useMemo(() => analyzeDraws(scenario), [scenario]);
  const remainingBoardCards = hero.remainingBoardCards;
  const nextName = nextStreetName(remainingBoardCards);
  const singleStreet = remainingBoardCards < 2;

  if (hero.finished) {
    return (
      <section className="panel">
        <h2>后续听牌</h2>
        <p className="muted">河牌已经发完，没有后续公共牌可以再补成听牌了。</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>
        后续听牌（{singleStreet ? nextName : `${nextName} / 河牌`}）
      </h2>
      <p className="muted small">
        听牌只统计「顺子」与「同花」两种靠公共牌补成的牌型；已经成型的牌型不算听牌。
      </p>

      <h3 className="sub-heading">你的听牌</h3>
      <p className="muted small">
        {singleStreet
          ? `只剩 ${nextName} 一张牌：未知牌 ${hero.nextTotal} 张，其中补成即最终补成。`
          : `下一张 ${nextName} ${hero.nextTotal} 张；发完转牌 + 河牌为 C(${hero.nextTotal}, 2) = ${hero.finalTotal} 个等权后续。`}
      </p>

      {hero.rows.length === 0 ? (
        <p className="muted">
          当前 {hero.nextTotal} 张未知牌里没有可以补成的顺子 / 同花听牌
          （含后门听牌）。
        </p>
      ) : (
        <ul className="draw-list">
          {hero.rows.map((row) => (
            <li
              className={`draw ${row.backdoor ? 'draw--backdoor' : ''}`}
              key={`${row.target}-${row.label}`}
            >
              <div className="draw__head">
                <span className="draw__label">{row.label}</span>
                {row.backdoor ? (
                  <span className="draw__tag draw__tag--backdoor">
                    后门 · {nextName}补不成，需连来两张
                  </span>
                ) : (
                  <span className="draw__tag">
                    补牌 {row.completion.outs.length} 张
                  </span>
                )}
              </div>
              <OutChips completion={row.completion} />
              <CompletionStats
                completion={row.completion}
                remainingBoardCards={remainingBoardCards}
              />
            </li>
          ))}
          {hero.rows.length > 1 && (
            <li className="draw draw--any">
              <div className="draw__head">
                <span className="draw__label">至少补成一种听牌</span>
                <span className="draw__tag">
                  {hero.union.nextCount === 0
                    ? '需连来两张'
                    : `${nextName} ${hero.union.outs.length} 张补牌`}
                </span>
              </div>
              <OutChips completion={hero.union} />
              <CompletionStats
                completion={hero.union}
                remainingBoardCards={remainingBoardCards}
              />
            </li>
          )}
        </ul>
      )}

      <h3 className="sub-heading">
        对手的听牌（{opponent.totalCombos} 个随机手牌组合）
      </h3>
      <p className="muted small">
        {singleStreet
          ? `对手拿走后剩余 ${opponent.nextTotal} 张未知牌，${nextName}只有一张：同一组合可能同时有同花与顺子听牌，因此分类组合数可以重叠。`
          : `对手拿走后剩余 ${opponent.nextTotal} 张未知牌：${nextName} ${opponent.nextTotal} 张，发完 ${opponent.finalTotal} 个等权后续。同一组合可能同时有同花与顺子听牌，因此分类组合数可以重叠。`}
      </p>

      <ul className="overall-list">
        <li className="overall-list__item">
          <span className="overall-list__label">
            有立即听牌（{nextName}有补牌）
          </span>
          <span className="overall-list__value">
            <span className="overall-list__count">
              {opponent.immediateCombos} / {opponent.totalCombos}
            </span>
            <Pct
              value={opponent.immediateCombos / opponent.totalCombos}
              tone="neutral"
              size="md"
            />
          </span>
        </li>
        <li className="overall-list__item">
          <span className="overall-list__label">只有后门听牌</span>
          <span className="overall-list__value">
            <span className="overall-list__count">
              {opponent.backdoorOnlyCombos} / {opponent.totalCombos}
            </span>
            <Pct
              value={opponent.backdoorOnlyCombos / opponent.totalCombos}
              tone="neutral"
              size="md"
            />
          </span>
        </li>
        <li className="overall-list__item">
          <span className="overall-list__label">完全没有听牌</span>
          <span className="overall-list__value">
            <span className="overall-list__count">
              {opponent.noDrawCombos} / {opponent.totalCombos}
            </span>
            <Pct
              value={opponent.noDrawCombos / opponent.totalCombos}
              tone="neutral"
              size="md"
            />
          </span>
        </li>
      </ul>

      <ul
        className={`draw-table ${singleStreet ? 'draw-table--no-final' : ''}`}
      >
        <li className="draw-table__head">
          <span>听牌类型</span>
          <span>组合数 / 占比</span>
          <span>{nextName}补成（平均）</span>
          {!singleStreet && <span>到河牌补成（平均）</span>}
          <span>拿到且补成</span>
        </li>
        {opponent.rows.map((row) => (
          <OpponentRow
            row={row}
            remainingBoardCards={remainingBoardCards}
            key={row.kind}
          />
        ))}
        {opponent.backdoorRow && (
          <OpponentRow
            row={opponent.backdoorRow}
            remainingBoardCards={remainingBoardCards}
          />
        )}
      </ul>

      <p className="muted small draw-tip">
        红色 = 该类听牌占全部 {opponent.totalCombos} 个组合；蓝色 = 拿到该类听牌后的平均补成率；
        紫色 = 对手拿到该类听牌且真的补成（占全部 {opponent.totalCombos}）。
      </p>

      <div className="draw-summary">
        <div className="draw-summary__row">
          <span className="draw-summary__label">对手有听牌的组合</span>
          <CountBadge count={opponent.drawingCombos} />
          <Pct
            value={opponent.drawingCombos / opponent.totalCombos}
            tone="neutral"
            size="md"
          />
        </div>
        <div className="draw-summary__row draw-summary__row--main">
          <span className="draw-summary__label">
            对手拿到听牌并在河牌前补成
          </span>
          <Pct value={opponent.completeProbability} tone="danger" size="lg" />
          <span className="muted small">
            （有听牌时平均补成率{' '}
            <Pct
              value={opponent.completeConditionalProbability}
              tone="neutral"
              size="md"
            />
            ）
          </span>
        </div>
      </div>
    </section>
  );
}
