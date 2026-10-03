import { useMemo, useState } from 'react';
import { analyzeFlopScenario } from '../poker/analyzer';
import type { Comparison } from '../poker/analyzer';
import type { FlopScenario } from '../poker/cards';
import { parseCards, validateScenario } from '../poker/cards';
import {
  ALL_HAND_CATEGORIES,
  HAND_CATEGORY_LABELS,
  HandCategory,
} from '../poker/evaluator';
import { sortCardsDesc } from '../poker/grouping';
import { CardPair } from '../components/Card';
import { formatPercent } from '../trainer/ranges';

interface DebugScenario {
  scenario: FlopScenario;
  error?: undefined;
}
interface DebugError {
  scenario?: undefined;
  error: string;
}

function parseScenario(heroText: string, flopText: string): DebugScenario | DebugError {
  try {
    const hero = parseCards(heroText);
    const flop = parseCards(flopText);
    if (hero.length !== 2) return { error: `Hero 需要 2 张牌，当前 ${hero.length} 张` };
    if (flop.length !== 3) return { error: `Flop 需要 3 张牌，当前 ${flop.length} 张` };
    const scenario: FlopScenario = {
      hero: [hero[0], hero[1]],
      flop: [flop[0], flop[1], flop[2]],
    };
    validateScenario(scenario);
    return { scenario };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const COMPARISON_LABELS: Record<Comparison, string> = {
  ahead: '对手领先',
  tie: '平手',
  behind: '对手落后',
};

export function DebugPage() {
  const [heroText, setHeroText] = useState('As Kd');
  const [flopText, setFlopText] = useState('Ah 8c 3d');
  const [comparison, setComparison] = useState<'all' | Comparison>('all');
  const [category, setCategory] = useState<'all' | HandCategory>('all');
  const [rankGroup, setRankGroup] = useState<'all' | string>('all');

  const parsed = useMemo(
    () => parseScenario(heroText, flopText),
    [heroText, flopText],
  );

  const analysis = useMemo(
    () => (parsed.scenario ? analyzeFlopScenario(parsed.scenario) : null),
    [parsed],
  );

  const rankGroups = useMemo(() => {
    if (!analysis) return [];
    return [...new Set(analysis.results.map((result) => result.rankGroup))].sort();
  }, [analysis]);

  const filtered = useMemo(() => {
    if (!analysis) return [];
    return analysis.results.filter((result) => {
      if (comparison !== 'all' && result.comparison !== comparison) return false;
      if (category !== 'all' && result.category !== category) return false;
      if (rankGroup !== 'all' && result.rankGroup !== rankGroup) return false;
      return true;
    });
  }, [analysis, comparison, category, rankGroup]);

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>调试页 · 1081 组合枚举</h1>
          <p className="muted">仅开发模式可见，用于验证算法。</p>
        </div>
      </header>

      <section className="panel debug-inputs">
        <label>
          <span>Hero（2 张，如 As Kd）</span>
          <input value={heroText} onChange={(event) => setHeroText(event.target.value)} />
        </label>
        <label>
          <span>Flop（3 张，如 Ah 8c 3d）</span>
          <input value={flopText} onChange={(event) => setFlopText(event.target.value)} />
        </label>
      </section>

      {parsed.error && <p className="error">解析失败：{parsed.error}</p>}

      {analysis && (
        <>
          <section className="panel">
            <h2>筛选</h2>
            <div className="filters">
              <label>
                <span>领先关系</span>
                <select
                  value={comparison}
                  onChange={(event) =>
                    setComparison(event.target.value as 'all' | Comparison)
                  }
                >
                  <option value="all">全部</option>
                  <option value="ahead">对手领先</option>
                  <option value="tie">平手</option>
                  <option value="behind">对手落后</option>
                </select>
              </label>
              <label>
                <span>牌型</span>
                <select
                  value={String(category)}
                  onChange={(event) =>
                    setCategory(
                      event.target.value === 'all'
                        ? 'all'
                        : (Number(event.target.value) as HandCategory),
                    )
                  }
                >
                  <option value="all">全部</option>
                  {ALL_HAND_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {HAND_CATEGORY_LABELS[item]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>点数类型</span>
                <select
                  value={rankGroup}
                  onChange={(event) => setRankGroup(event.target.value)}
                >
                  <option value="all">全部</option>
                  {rankGroups.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted">
              总体：领先 {analysis.aheadCount} · 平手 {analysis.tieCount} · 落后{' '}
              {analysis.behindCount} · 共 {analysis.totalOpponentCombos}
              （{formatPercent(analysis.aheadProbability)} /{' '}
              {formatPercent(analysis.tieProbability)} /{' '}
              {formatPercent(analysis.behindProbability)}）
            </p>
            <p className="muted">当前筛选结果：{filtered.length} 个组合</p>
          </section>

          <section className="panel">
            <table className="debug-table">
              <thead>
                <tr>
                  <th>对手手牌</th>
                  <th>点数类型</th>
                  <th>牌型</th>
                  <th>关系</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((result) => {
                  const key = result.holeCards.map((c) => `${c.rank}${c.suit}`).join('-');
                  return (
                    <tr key={key}>
                      <td>
                        <CardPair cards={sortCardsDesc(result.holeCards)} />
                      </td>
                      <td>{result.rankGroup}</td>
                      <td>{HAND_CATEGORY_LABELS[result.category]}</td>
                      <td>{COMPARISON_LABELS[result.comparison]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
