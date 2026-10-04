import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Card as CardType } from '../poker/cards';
import { isRedSuit, SUIT_SYMBOLS } from '../poker/cards';
import type {
  FlopMadeRow,
  FlopTaxonomy,
  FlopTypeExample,
  FlopTypeGroup,
  FlopTypeRow,
} from '../poker/flopTaxonomy';
import {
  createFlopTaxonomyScanner,
  FLOP_TYPE_GROUPS,
  FLOP_TYPE_GROUP_LABELS,
  FLOP_TYPE_GROUP_SHORT,
} from '../poker/flopTaxonomy';

/**
 * 翻牌牌型图鉴：把 Hero 2 张 + 翻牌 3 张的全部 25,989,600 种等权组合归类成
 * 「相似牌型」，并按出现频率排序。所有数字都在浏览器里现场枚举得到（约 2~3 秒，
 * 进度条分片计算），没有任何预置的表格。
 */

const CACHE_KEY = 'flop-trainer:flop-taxonomy:v1';

let memoryCache: FlopTaxonomy | null = null;

function loadCache(): FlopTaxonomy | null {
  if (memoryCache) return memoryCache;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      memoryCache = JSON.parse(raw) as FlopTaxonomy;
      return memoryCache;
    }
  } catch {
    /* 忽略缓存异常，重新枚举 */
  }
  return null;
}

function saveCache(taxonomy: FlopTaxonomy): void {
  memoryCache = taxonomy;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(taxonomy));
  } catch {
    /* 缓存失败不影响使用 */
  }
}

/** 小概率要多留几位有效数字。 */
function formatProbability(probability: number): string {
  if (probability >= 0.001) return `${(probability * 100).toFixed(2)}%`;
  if (probability >= 0.00001) return `${(probability * 100).toFixed(3)}%`;
  return `${(probability * 100).toFixed(4)}%`;
}

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

/** 首次进入页面时现场枚举（分片 + 进度条）。 */
function useTaxonomy() {
  const [taxonomy, setTaxonomy] = useState<FlopTaxonomy | null>(() => loadCache());
  const [orbitTotal, setOrbitTotal] = useState(0);
  const [processed, setProcessed] = useState(0);

  useEffect(() => {
    if (taxonomy) return;
    const scanner = createFlopTaxonomyScanner();
    setOrbitTotal(scanner.orbitTotal);
    let cancelled = false;
    let timer = 0;
    const step = () => {
      if (cancelled) return;
      scanner.advance(900);
      setProcessed(scanner.processed);
      if (scanner.done) {
        const result = scanner.result();
        saveCache(result);
        setTaxonomy(result);
        return;
      }
      timer = window.setTimeout(step, 0);
    };
    timer = window.setTimeout(step, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [taxonomy]);

  return {
    taxonomy,
    processed,
    orbitTotal,
    progress: orbitTotal === 0 ? 0 : processed / orbitTotal,
  };
}

function MiniCard({ card }: { card: CardType }) {
  const red = isRedSuit(card.suit);
  return (
    <span className={`mini-card ${red ? 'mini-card--red' : 'mini-card--black'}`}>
      {card.rank}
      {SUIT_SYMBOLS[card.suit]}
    </span>
  );
}

/** 例子：左边 2 张底牌，右边 3 张翻牌。 */
function ExampleCards({ example }: { example: FlopTypeExample }) {
  return (
    <span
      className="tax-example"
      title={`Hero ${example.heroLabel} ｜ 翻牌 ${example.flopLabel}`}
    >
      <span className="tax-example__part">
        {example.hero.map((card) => (
          <MiniCard key={`${card.rank}${card.suit}`} card={card} />
        ))}
      </span>
      <span className="tax-example__sep">/</span>
      <span className="tax-example__part">
        {example.flop.map((card) => (
          <MiniCard key={`${card.rank}${card.suit}`} card={card} />
        ))}
      </span>
    </span>
  );
}

interface RowView {
  key: string;
  label: string;
  group: FlopTypeGroup;
  count: number;
  probability: number;
  example: FlopTypeExample;
  /** 合并视图里这一行包含的明细种类。 */
  members?: string[];
  note?: string;
}

export function FlopTypesPage() {
  const { taxonomy, progress, processed, orbitTotal } = useTaxonomy();
  const [view, setView] = useState<'merged' | 'detail'>('merged');
  const [activeGroup, setActiveGroup] = useState<FlopTypeGroup | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rowByLabel = useMemo(
    () => new Map((taxonomy?.rows ?? []).map((row) => [row.label, row])),
    [taxonomy],
  );

  const rows: RowView[] = useMemo(() => {
    if (!taxonomy) return [];
    const source: (FlopMadeRow | FlopTypeRow)[] =
      view === 'merged' ? taxonomy.madeRows : taxonomy.rows;
    return source
      .filter((row) => activeGroup === null || row.group === activeGroup)
      .map((row) => ({
        key: row.label,
        label: row.label,
        group: row.group,
        count: row.count,
        probability: row.probability,
        example: row.example,
        members: 'memberCount' in row ? row.members : undefined,
      }));
  }, [taxonomy, view, activeGroup]);

  const maxCount = rows.length > 0 ? Math.max(...rows.map((row) => row.count)) : 1;

  if (!taxonomy) {
    return (
      <div className="page">
        <header className="page__header">
          <div>
            <h1>翻牌牌型图鉴</h1>
            <p className="muted">
              正在枚举全部 25,989,600 种「底牌 + 翻牌」组合，并按相似牌型归类…
            </p>
          </div>
          <div className="page__header-actions">
            <Link className="button button--ghost" to="/">
              返回训练
            </Link>
          </div>
        </header>
        <section className="panel">
          <div
            className="tax-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="枚举进度"
          >
            <div className="tax-progress__fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="muted small">
            {Math.round(progress * 100)}%（已处理 {formatCount(processed)} /{' '}
            {formatCount(orbitTotal)} 个花色等价类）
          </p>
        </section>
      </div>
    );
  }

  const groupCount = (group: FlopTypeGroup) =>
    taxonomy.groupTotals.find((entry) => entry.group === group)!;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>翻牌牌型图鉴</h1>
          <p className="muted">
            全部 <strong>{formatCount(taxonomy.total)}</strong> 种「Hero 2 张 + 翻牌 3 张」
            等权组合，按相似牌型归类后的出现频率。
          </p>
        </div>
        <div className="page__header-actions">
          <Link className="button button--ghost" to="/table">
            模拟牌桌
          </Link>
          <Link className="button button--ghost" to="/">
            返回训练
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="tax-stack" role="img" aria-label="五类牌型的占比">
          {FLOP_TYPE_GROUPS.map((group) => (
            <span
              key={group}
              className={`tax-stack__seg tax-stack__seg--${group}`}
              style={{ width: `${groupCount(group).probability * 100}%` }}
              title={`${FLOP_TYPE_GROUP_LABELS[group]} ${formatProbability(
                groupCount(group).probability,
              )}`}
            />
          ))}
        </div>
        <div className="tax-groups">
          <button
            type="button"
            className={`tax-group ${activeGroup === null ? 'tax-group--active' : ''}`}
            aria-pressed={activeGroup === null}
            onClick={() => setActiveGroup(null)}
          >
            <span className="tax-group__label">全部</span>
            <strong className="tax-group__pct">100%</strong>
            <span className="muted small">{formatCount(taxonomy.total)} 种</span>
          </button>
          {FLOP_TYPE_GROUPS.map((group) => {
            const total = groupCount(group);
            return (
              <button
                key={group}
                type="button"
                className={`tax-group tax-group--${group} ${
                  activeGroup === group ? 'tax-group--active' : ''
                }`}
                aria-pressed={activeGroup === group}
                onClick={() =>
                  setActiveGroup(activeGroup === group ? null : group)
                }
              >
                <span className="tax-group__label">{FLOP_TYPE_GROUP_SHORT[group]}</span>
                <strong className="tax-group__pct">
                  {formatProbability(total.probability)}
                </strong>
                <span className="muted small">{formatCount(total.count)} 种</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="tax-toolbar">
          <div className="result-tabs tax-tabs" role="group" aria-label="归类方式">
            <button
              type="button"
              className={`result-tab ${view === 'merged' ? 'is-active' : ''}`}
              aria-pressed={view === 'merged'}
              onClick={() => setView('merged')}
            >
              <span className="result-tab__label">按牌型</span>
              <span className="result-tab__hint">
                合并听牌 · {taxonomy.madeRows.length} 行
              </span>
            </button>
            <button
              type="button"
              className={`result-tab ${view === 'detail' ? 'is-active' : ''}`}
              aria-pressed={view === 'detail'}
              onClick={() => setView('detail')}
            >
              <span className="result-tab__label">含听牌明细</span>
              <span className="result-tab__hint">
                成牌 + 听牌 · {taxonomy.rows.length} 行
              </span>
            </button>
          </div>
          <p className="muted small tax-legend">
            例子：左 2 张 = Hero 底牌，右 3 张 = 翻牌；牌型已按花色合并（同花听牌不写花色）。
          </p>
        </div>

        <div className="tax-list">
          {FLOP_TYPE_GROUPS.map((group) => {
            const groupRows = rows.filter((row) => row.group === group);
            if (groupRows.length === 0) return null;
            const total = groupCount(group);
            return (
              <Fragment key={group}>
                <div className={`tax-section tax-section--${group}`}>
                  <span className="tax-section__name">
                    {FLOP_TYPE_GROUP_LABELS[group]}
                  </span>
                  <span className="tax-section__pct">
                    {formatProbability(total.probability)}
                  </span>
                </div>
                {groupRows.map((row) => {
                  const isOpen = expanded === row.key;
                  const hasMembers = (row.members?.length ?? 0) > 1;
                  return (
                    <div className="tax-row" key={`${view}:${row.key}`}>
                      <div className="tax-row__head">
                        <span className="tax-row__label">{row.label}</span>
                        <span className="tax-row__pct">
                          {formatProbability(row.probability)}
                        </span>
                      </div>
                      <div
                        className="tax-row__bar"
                        aria-hidden="true"
                      >
                        <span
                          className={`tax-row__bar-fill tax-bar--${group}`}
                          style={{ width: `${(row.count / maxCount) * 100}%` }}
                        />
                      </div>
                      <div className="tax-row__meta">
                        <span className="muted small">{formatCount(row.count)} 种组合</span>
                        <ExampleCards example={row.example} />
                        {hasMembers && (
                          <button
                            type="button"
                            className="tax-row__toggle"
                            aria-expanded={isOpen}
                            onClick={() => setExpanded(isOpen ? null : row.key)}
                          >
                            {isOpen ? '收起' : `展开 ${row.members!.length} 种明细`}
                          </button>
                        )}
                      </div>
                      {hasMembers && isOpen && (
                        <ul className="tax-members">
                          {row.members!.map((member) => {
                            const detail = rowByLabel.get(member);
                            return (
                              <li key={member}>
                                <span>{member}</span>
                                <span className="muted small">
                                  {formatProbability(detail?.probability ?? 0)}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2 className="tax-note__title">这些数字是怎么来的</h2>
        <ul className="tax-note">
          <li>
            对手（和其他未知牌）不影响牌型本身，所以枚举的是「Hero 2 张 + 翻牌 3 张」的
            <strong> 全部 {formatCount(taxonomy.total)} 种等权组合</strong>：
            C(52,2) × C(50,3)。
          </li>
          <li>
            整体置换花色不会改变牌型和听牌，所以只需枚举 {formatCount(taxonomy.orbitCount)}{' '}
            个「花色等价类」（{formatCount(taxonomy.total / 10)} 个 5 张牌组合压缩而来），
            每个等价类再乘以它的权重，并展开成 10 种「哪两张是底牌」的切分。
          </li>
          <li>
            牌型划分与训练器结果页的「当前 5 张牌」完全一致（成牌名 + 听牌名），
            顺子听牌按补牌点数分为卡顺 / 两头顺 / 多个补牌点，后门听牌指「下一张补不上、
            再下一张能补上」。
          </li>
          <li>
            排序按组合数从多到少；同牌型的不同花色、不同点数只按「相似类型」合并展示，
            不展开每一种具体点数。
          </li>
        </ul>
      </section>
    </div>
  );
}
