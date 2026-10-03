import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Card, Rank, Suit } from '../poker/cards';
import { isRedSuit, SUIT_SYMBOLS } from '../poker/cards';
import type {
  BoardLookup,
  BoardPairing,
  BoardSuitClass,
  BoardTextureAtlas,
  BoardTextureLevel,
  BoardTextureRow,
} from '../poker/boardTexture';
import {
  BOARD_TEXTURE_LEVELS,
  BOARD_TEXTURE_LEVEL_HINTS,
  BOARD_TEXTURE_LEVEL_LABELS,
  PAIRING_ORDER,
  PAIRING_LABELS,
  STRUCTURE_LABELS,
  SUIT_CLASS_LABELS,
  SUIT_CLASS_ORDER,
  buildBoardTextureAtlas,
  lookupBoard,
} from '../poker/boardTexture';

/**
 * 牌面结构图鉴：把全部 22,100 种翻牌（C(52,3)）按牌面结构归类。
 * 与「翻牌牌型图鉴」不同，这里只看翻牌本身，与 Hero 的底牌无关。
 *
 * 三个层级共用同一次枚举（约 0.1 秒，直接同步算完）：
 *   策略牌面 1,755 / 牌面形状 379 / 形状 × 花色 247。
 */

let cachedAtlas: BoardTextureAtlas | null = null;

const SECTION_PREVIEW = 6;

const PRESETS = ['AsKsQd', 'AhKdQc', '7h7d2c', 'AsAhAd', 'Ac2d3h'];

/** 小概率要多留几位有效数字。 */
function formatProbability(probability: number): string {
  if (probability >= 0.01) return `${(probability * 100).toFixed(2)}%`;
  if (probability >= 0.0001) return `${(probability * 100).toFixed(3)}%`;
  return `${(probability * 100).toFixed(4)}%`;
}

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

function MiniCard({ card }: { card: Card }) {
  const red = isRedSuit(card.suit);
  return (
    <span className={`mini-card ${red ? 'mini-card--red' : 'mini-card--black'}`}>
      {card.rank}
      {SUIT_SYMBOLS[card.suit]}
    </span>
  );
}

const RANK_ALIASES: Record<string, Rank> = {
  '10': 'T',
  T: 'T',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
};

const SUIT_ALIASES: Record<string, Suit> = {
  s: 's',
  '♠': 's',
  h: 'h',
  '♥': 'h',
  d: 'd',
  '♦': 'd',
  c: 'c',
  '♣': 'c',
};

/** 支持 AsKsQd / A♠K♠Q♦ / As Ks Qd / 10sJhQd。 */
function parseBoardInput(raw: string): Card[] | string {
  const tokens = raw.matchAll(/(10|[2-9TtJjQqKkAa])\s*([shdc♠♥♦♣])/gi);
  const parsed: Card[] = [];
  for (const token of tokens) {
    const rank = RANK_ALIASES[token[1].toUpperCase()];
    const suit = SUIT_ALIASES[token[2].toLowerCase()];
    if (rank && suit) parsed.push({ rank, suit });
  }
  if (parsed.length === 0) return '没看懂牌面，试试 AsKsQd 或 A♠K♠Q♦';
  if (parsed.length < 3) {
    return `还差 ${3 - parsed.length} 张牌（现在识别到 ${parsed.length} 张）`;
  }
  const unique = new Set(parsed.map((card) => `${card.rank}${card.suit}`));
  if (unique.size !== parsed.length) return '输入里有重复的牌';
  return parsed.slice(0, 3);
}

interface SectionView {
  label: string;
  rows: BoardTextureRow[];
  count: number;
  classCount: number;
}

export function BoardTexturePage() {
  const atlas = useMemo(
    () => cachedAtlas ?? (cachedAtlas = buildBoardTextureAtlas()),
    [],
  );
  const [level, setLevel] = useState<BoardTextureLevel>('strategic');
  const [suitFilter, setSuitFilter] = useState<BoardSuitClass | null>(null);
  const [pairingFilter, setPairingFilter] = useState<BoardPairing | null>(null);
  const [query, setQuery] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [lookupText, setLookupText] = useState('');
  const [lookup, setLookup] = useState<BoardLookup | null>(null);
  const [lookupError, setLookupError] = useState('');

  const view = atlas.levels[level];

  useEffect(() => {
    setOpenSections({});
  }, [level, suitFilter, pairingFilter, query]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtering = normalizedQuery !== '' || suitFilter !== null || pairingFilter !== null;

  const sections: SectionView[] = useMemo(
    () =>
      view.sections
        .map((section) => {
          const rows = section.rows.filter((row) => {
            if (suitFilter && row.suitClass !== suitFilter) return false;
            if (pairingFilter && row.pairing !== pairingFilter) return false;
            if (normalizedQuery) {
              const haystack = [
                row.label,
                row.exampleLabel,
                row.rankLabel,
                row.highLabel,
                PAIRING_LABELS[row.pairing],
                SUIT_CLASS_LABELS[row.suitClass],
                STRUCTURE_LABELS[row.structure],
              ]
                .join(' ')
                .toLowerCase();
              if (!haystack.includes(normalizedQuery)) return false;
            }
            return true;
          });
          return {
            label: section.label,
            rows,
            count: rows.reduce((sum, row) => sum + row.count, 0),
            classCount: rows.length,
          };
        })
        .filter((section) => section.classCount > 0),
    [view, suitFilter, pairingFilter, normalizedQuery],
  );

  const shownClasses = sections.reduce((sum, s) => sum + s.classCount, 0);
  const shownFlops = sections.reduce((sum, s) => sum + s.count, 0);
  const maxCount = view.rows[0].count;

  const runLookup = (text: string) => {
    const parsed = parseBoardInput(text);
    if (typeof parsed === 'string') {
      setLookup(null);
      setLookupError(parsed);
      return;
    }
    try {
      setLookup(lookupBoard(atlas, parsed));
      setLookupError('');
    } catch (error) {
      setLookup(null);
      setLookupError(error instanceof Error ? error.message : '查不了这个牌面');
    }
  };

  const suitTotal = (suitClass: BoardSuitClass) =>
    atlas.suitTotals.find((entry) => entry.value === suitClass)!;
  const pairingTotal = (pairing: BoardPairing) =>
    atlas.pairingTotals.find((entry) => entry.value === pairing)!;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>牌面结构图鉴</h1>
          <p className="muted">
            全部 <strong>{formatCount(atlas.totalFlops)}</strong> 种翻牌（C(52,3)）按牌面结构归类：
            与底牌无关，只看翻牌自己的点数、成对与同花结构。
          </p>
        </div>
        <div className="page__header-actions">
          <Link className="button button--ghost" to="/flop-types">
            翻牌牌型图鉴
          </Link>
          <Link className="button button--ghost" to="/">
            返回训练
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="tax-stack" role="img" aria-label="花色结构占比">
          {SUIT_CLASS_ORDER.map((suitClass) => (
            <span
              key={suitClass}
              className={`tax-stack__seg tax-stack__seg--${suitClass}`}
              style={{ width: `${suitTotal(suitClass).probability * 100}%` }}
              title={`${SUIT_CLASS_LABELS[suitClass]} ${formatProbability(
                suitTotal(suitClass).probability,
              )}`}
            />
          ))}
        </div>
        <div className="tax-groups">
          <button
            type="button"
            className={`tax-group ${suitFilter === null && pairingFilter === null ? 'tax-group--active' : ''}`}
            aria-pressed={suitFilter === null && pairingFilter === null}
            onClick={() => {
              setSuitFilter(null);
              setPairingFilter(null);
            }}
          >
            <span className="tax-group__label">全部牌面</span>
            <strong className="tax-group__pct">100%</strong>
            <span className="muted small">{formatCount(atlas.totalFlops)} 种</span>
          </button>
          {SUIT_CLASS_ORDER.map((suitClass) => {
            const total = suitTotal(suitClass);
            return (
              <button
                key={suitClass}
                type="button"
                className={`tax-group tax-group--${suitClass} ${
                  suitFilter === suitClass ? 'tax-group--active' : ''
                }`}
                aria-pressed={suitFilter === suitClass}
                onClick={() =>
                  setSuitFilter(suitFilter === suitClass ? null : suitClass)
                }
              >
                <span className="tax-group__label">
                  {SUIT_CLASS_LABELS[suitClass]}
                </span>
                <strong className="tax-group__pct">
                  {formatProbability(total.probability)}
                </strong>
                <span className="muted small">{formatCount(total.count)} 种</span>
              </button>
            );
          })}
          {PAIRING_ORDER.map((pairing) => {
            const total = pairingTotal(pairing);
            return (
              <button
                key={pairing}
                type="button"
                className={`tax-group tax-group--pair-${pairing} ${
                  pairingFilter === pairing ? 'tax-group--active' : ''
                }`}
                aria-pressed={pairingFilter === pairing}
                onClick={() =>
                  setPairingFilter(pairingFilter === pairing ? null : pairing)
                }
              >
                <span className="tax-group__label">{PAIRING_LABELS[pairing]}</span>
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
        <h2 className="board-lookup__title">查一个翻牌</h2>
        <div className="board-lookup">
          <label className="board-lookup__label" htmlFor="board-lookup-input">
            输入 3 张牌（是否同花、点数连不连、带不带对，一眼看清它属于哪一类）
          </label>
          <div className="board-lookup__row">
            <input
              id="board-lookup-input"
              className="board-lookup__input"
              value={lookupText}
              placeholder="例如 AsKsQd / A♠K♠Q♦"
              onChange={(event) => setLookupText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') runLookup(lookupText);
              }}
            />
            <button
              type="button"
              className="button"
              onClick={() => runLookup(lookupText)}
            >
              查
            </button>
          </div>
          <div className="board-lookup__presets">
            {PRESETS.map((preset) => {
              const parsed = parseBoardInput(preset);
              return (
                <button
                  key={preset}
                  type="button"
                  className="board-lookup__preset"
                  onClick={() => {
                    setLookupText(preset);
                    runLookup(preset);
                  }}
                >
                  {typeof parsed === 'string'
                    ? preset
                    : parsed.map((card) => (
                        <MiniCard key={`${card.rank}${card.suit}`} card={card} />
                      ))}
                </button>
              );
            })}
          </div>
          {lookupError && <p className="board-lookup__error">{lookupError}</p>}
          {lookup && (
            <div className="board-lookup__result">
              <div className="board-lookup__cards">
                {lookup.cards.map((card) => (
                  <MiniCard key={`${card.rank}${card.suit}`} card={card} />
                ))}
                <span className="board-lookup__summary">{lookup.summary}</span>
              </div>
              <ul className="board-lookup__entries">
                {lookup.entries.map((entry) => (
                  <li key={entry.level}>
                    <span className="board-lookup__entry-level">
                      {BOARD_TEXTURE_LEVEL_LABELS[entry.level]}
                    </span>
                    <span className="board-lookup__entry-label">{entry.label}</span>
                    <strong className="board-lookup__entry-pct">
                      {formatProbability(entry.probability)}
                    </strong>
                    <span className="muted small">
                      {formatCount(entry.count)} 种
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="tax-toolbar">
          <div className="result-tabs tax-tabs" role="group" aria-label="归类粒度">
            {BOARD_TEXTURE_LEVELS.map((candidate) => {
              const candidateView = atlas.levels[candidate];
              return (
                <button
                  key={candidate}
                  type="button"
                  className={`result-tab ${level === candidate ? 'is-active' : ''}`}
                  aria-pressed={level === candidate}
                  onClick={() => setLevel(candidate)}
                >
                  <span className="result-tab__label">
                    {BOARD_TEXTURE_LEVEL_LABELS[candidate]}
                  </span>
                  <span className="result-tab__hint">
                    {formatCount(candidateView.classCount)} 类 ·{' '}
                    {BOARD_TEXTURE_LEVEL_HINTS[candidate]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="board-filter">
          <input
            className="board-filter__input"
            value={query}
            placeholder="筛选：AKQ / 两色 / 三连张 / 带对 / A 高"
            onChange={(event) => setQuery(event.target.value)}
          />
          {filtering && (
            <button
              type="button"
              className="board-filter__clear"
              onClick={() => {
                setQuery('');
                setSuitFilter(null);
                setPairingFilter(null);
              }}
            >
              清空筛选
            </button>
          )}
        </div>

        <p className="muted small board-filter__summary">
          {BOARD_TEXTURE_LEVEL_LABELS[level]}：{formatCount(shownClasses)} 类 ·{' '}
          {formatCount(shownFlops)} 种翻牌 ·{' '}
          {formatProbability(shownFlops / atlas.totalFlops)}
          {filtering ? '（已筛选）' : ''}｜每类平均{' '}
          {(atlas.totalFlops / view.classCount).toFixed(1)} 种
        </p>

        <div className="tax-list">
          {sections.length === 0 && (
            <p className="muted small">没有匹配的牌面，换个说法试试。</p>
          )}
          {sections.map((section) => {
            const open = openSections[section.label] === true;
            const hidden = section.rows.length - SECTION_PREVIEW;
            const visible =
              open || filtering ? section.rows : section.rows.slice(0, SECTION_PREVIEW);
            const tone =
              level === 'coarse'
                ? `pair-${section.rows[0].pairing}`
                : section.rows[0].suitClass;
            return (
              <Fragment key={section.label}>
                <div className={`tax-section tax-section--${tone}`}>
                  <span className="tax-section__name">{section.label}</span>
                  <span className="tax-section__pct">
                    {formatProbability(section.count / atlas.totalFlops)}
                  </span>
                </div>
                {visible.map((row) => (
                  <div className="tax-row" key={`${level}:${row.key}`}>
                    <div className="tax-row__head">
                      <span className="tax-row__label">{row.label}</span>
                      <span className="tax-row__pct">
                        {formatProbability(row.probability)}
                      </span>
                    </div>
                    <div className="tax-row__bar" aria-hidden="true">
                      <span
                        className={`tax-row__bar-fill tax-bar--${row.suitClass}`}
                        style={{ width: `${(row.count / maxCount) * 100}%` }}
                      />
                    </div>
                    <div className="tax-row__meta">
                      <span className="muted small">
                        这一类有 {formatCount(row.count)} 种翻牌
                      </span>
                      <span className="tax-example" title={row.exampleLabel}>
                        <span className="tax-example__part">
                          {row.example.map((card) => (
                            <MiniCard key={`${card.rank}${card.suit}`} card={card} />
                          ))}
                        </span>
                      </span>
                    </div>
                  </div>
                ))}
                {!filtering && hidden > 0 && (
                  <button
                    type="button"
                    className="tax-row__toggle board-more"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenSections((prev) => ({
                        ...prev,
                        [section.label]: !open,
                      }))
                    }
                  >
                    {open ? '收起' : `展开其余 ${hidden} 类`}
                  </button>
                )}
              </Fragment>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2 className="tax-note__title">三种粒度，各看什么</h2>
        <ul className="tax-note">
          <li>
            <strong>策略牌面（{formatCount(atlas.levels.strategic.classCount)} 类）</strong>
            ：整体置换 4 种花色后相同算一类，点数保留。这是 GTO 软件建立翻牌库时说的
            「策略上不同的翻牌」——{formatCount(atlas.totalFlops)} 种翻牌压缩成{' '}
            {formatCount(atlas.levels.strategic.classCount)} 个牌面，平均每类{' '}
            {formatCount(atlas.totalFlops / atlas.levels.strategic.classCount)} 种。
          </li>
          <li>
            <strong>牌面形状（{formatCount(atlas.levels.shape.classCount)} 类）</strong>
            ：再把点数整体平移也合并 —— A♦K♥Q♠ 与 K♦Q♥J♠ 是同一种形状，只保留
            「跨度、间隔、哪几张同花」。
          </li>
          <li>
            <strong>形状 × 花色（{formatCount(atlas.levels.coarse.classCount)} 类）</strong>
            ：在形状的基础上只分单色 / 两色 / 彩虹，不再区分两色时是哪两张同花。
          </li>
          <li>
            占比 = 这一类包含的具体翻牌数 ÷ {formatCount(atlas.totalFlops)}。所有数字都是
            页面现场枚举 {formatCount(atlas.totalFlops)} 种翻牌算出来的，没有预置表格。
          </li>
          <li>
            成对情况：无对 {formatProbability(pairingTotal('unpaired').probability)}、带对{' '}
            {formatProbability(pairingTotal('pair').probability)}、三条{' '}
            {formatProbability(pairingTotal('trips').probability)}；花色结构：两色{' '}
            {formatProbability(suitTotal('two-tone').probability)}、彩虹{' '}
            {formatProbability(suitTotal('rainbow').probability)}、单色{' '}
            {formatProbability(suitTotal('monotone').probability)}（三条只可能是三张不同花）。
          </li>
        </ul>
      </section>
    </div>
  );
}
