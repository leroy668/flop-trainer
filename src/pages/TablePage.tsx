import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CardView } from '../components/Card';
import { decideBotAction, estimateEquity, toScenario } from '../poker/ai';
import type { Card as CardType } from '../poker/cards';
import { analyzeScenario } from '../poker/analyzer';
import { analyzeDraws } from '../poker/draws';
import { HAND_CATEGORY_LABELS, describeHandValue, evaluateBestHand } from '../poker/evaluator';
import { summarizeFiveCardHand } from '../poker/handType';
import { createRng } from '../poker/rng';
import {
  TABLE_BET_CAP,
  TABLE_CONSTANTS,
  TABLE_STREET_LABELS,
  applyAction,
  blindIndices,
  canRebuy,
  createTable,
  legalActions,
  rebuy,
  startHand,
  type ActionType,
  type Seat,
  type TableAction,
  type TableState,
} from '../poker/table';
import { formatPercent } from '../trainer/ranges';

/**
 * 模拟牌桌：你 + 1 ～ 5 个电脑玩家（人数随时可加减）。
 *
 * 规则见页面底部「本桌规则」；机器人用 `poker/ai.ts` 的胜率估计决策，
 * 所有动作都先经过 `legalActions` 过滤，因此不会出现非法动作。
 * 随机数发生器放在组件里（`rngRef`），所以撤回上一步之后机器人可能改主意。
 */

const HISTORY_LIMIT = 80;

const SPEEDS: { id: string; label: string; delay: number }[] = [
  { id: 'slow', label: '慢', delay: 1100 },
  { id: 'normal', label: '正常', delay: 650 },
  { id: 'fast', label: '快', delay: 220 },
];

const SETTINGS = {
  delay: 'flop-trainer:table-delay',
  equity: 'flop-trainer:table-equity',
  reveal: 'flop-trainer:table-reveal',
  bots: 'flop-trainer:table-bots',
  tableState: 'flop-trainer:table-saved-state',
  history: 'flop-trainer:table-saved-history',
};

/** 可以选的机器人数量（含 Hero 就是 2 ～ 6 人桌）。 */
const BOT_CHOICES = [1, 2, 3, 4, 5];
const DEFAULT_BOTS = 3;

function readBots(): number {
  const saved = Number(readSetting(SETTINGS.bots, String(DEFAULT_BOTS)));
  return BOT_CHOICES.includes(saved) ? saved : DEFAULT_BOTS;
}

function readSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // file:// 下可能拿不到 localStorage，忽略即可。
  }
}

function loadSavedTable(): { table: TableState; history: TableState[] } {
  try {
    const rawTable = localStorage.getItem(SETTINGS.tableState);
    if (rawTable) {
      const parsedTable = JSON.parse(rawTable) as TableState;
      if (
        parsedTable &&
        Array.isArray(parsedTable.seats) &&
        parsedTable.seats.length >= 2 &&
        parsedTable.seats[0]?.isHero
      ) {
        let history: TableState[] = [];
        try {
          const rawHistory = localStorage.getItem(SETTINGS.history);
          if (rawHistory) {
            const parsedHistory = JSON.parse(rawHistory);
            if (Array.isArray(parsedHistory)) history = parsedHistory;
          }
        } catch {
          history = [];
        }
        return { table: parsedTable, history };
      }
    }
  } catch {
    // 损坏或不可用则降级新开一桌
  }

  return {
    table: createTable({
      seed: (Date.now() ^ 0x5f3759df) >>> 0,
      seats: readBots() + 1,
    }),
    history: [],
  };
}

const ACTION_HINTS: Record<ActionType, string> = {
  fold: '放弃这一手',
  check: '不下注，看下一张',
  call: '跟上当前的注',
  bet: '下注 / 加注：档位 5 / 10 / 20，指的是本街你在自己面前的总投入，20 封顶',
  allin: '把剩下的筹码全部推进去（仅翻牌后，不受 20 封顶限制）',
};

interface UiState {
  table: TableState;
  history: TableState[];
}

type UiAction =
  | { type: 'hero'; action: TableAction }
  | { type: 'tick'; action: TableAction }
  | { type: 'next' }
  | { type: 'rebuy' }
  | { type: 'undo' }
  | { type: 'newGame'; seed: number; seats: number };

function reducer(state: UiState, action: UiAction): UiState {
  const keep = (): TableState[] =>
    [...state.history, state.table].slice(-HISTORY_LIMIT);

  switch (action.type) {
    case 'hero': {
      if (state.table.actor !== 0) return state;
      return { table: applyAction(state.table, 0, action.action), history: keep() };
    }
    case 'tick': {
      const actor = state.table.actor;
      if (actor === null || state.table.result) return state;
      return { table: applyAction(state.table, actor, action.action), history: keep() };
    }
    case 'next': {
      if (!state.table.result) return state;
      return { table: startHand(state.table), history: keep() };
    }
    case 'rebuy':
      return { table: rebuy(state.table, 0), history: keep() };
    case 'undo': {
      if (state.history.length === 0) return state;
      return {
        table: state.history[state.history.length - 1],
        history: state.history.slice(0, -1),
      };
    }
    case 'newGame':
      // 也把旧牌桌压进历史，改错人数时可以 ↩ 撤回上一步退回去。
      return {
        table: createTable({ seed: action.seed, seats: action.seats }),
        history: keep(),
      };
    default:
      return state;
  }
}

function boardKey(board: readonly CardType[]): string {
  return board.map((card) => `${card.rank}${card.suit}`).join(' ');
}

function StackValue({ value }: { value: number }) {
  return <strong className="seat__stack-value">{value}</strong>;
}

function SeatCard({
  table,
  seat,
  reveal,
  isButton,
  blind,
}: {
  table: TableState;
  seat: Seat;
  reveal: boolean;
  isButton: boolean;
  blind: 'sb' | 'bb' | null;
}) {
  const isActor = table.actor === seat.index && !table.result;
  const hand = table.result?.hands[seat.index] ?? null;
  const delta = table.result?.deltas[seat.index] ?? 0;

  const classes = [
    'seat',
    seat.isHero ? 'seat--hero' : '',
    isActor ? 'seat--active' : '',
    seat.folded ? 'seat--folded' : '',
    seat.allIn ? 'seat--allin' : '',
    table.result && delta > 0 ? 'seat--winner' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const showHole = seat.hole !== null && (seat.isHero || reveal || Boolean(hand));

  return (
    <div className={classes}>
      <div className="seat__head">
        <span className="seat__name">{seat.name}</span>
        <span className="seat__badges">
          {isButton && <span className="seat__badge seat__badge--dealer">庄</span>}
          {blind === 'sb' && <span className="seat__badge">小盲</span>}
          {blind === 'bb' && <span className="seat__badge">大盲</span>}
        </span>
      </div>

      <div className="seat__cards">
        {seat.hole ? (
          <>
            <CardView card={seat.hole[0]} hidden={!showHole} size="sm" />
            <CardView card={seat.hole[1]} hidden={!showHole} size="sm" />
          </>
        ) : (
          <span className="muted small">等待发牌</span>
        )}
      </div>

      {hand && <div className="seat__hand">{describeHandValue(hand)}</div>}

      <div className="seat__line">
        <span className="muted small">筹码</span>
        <StackValue value={seat.stack} />
        {seat.committedStreet > 0 && (
          <span className="seat__bet">已下 {seat.committedStreet}</span>
        )}
      </div>
      {Boolean(seat.totalBuyIn && seat.totalBuyIn > TABLE_CONSTANTS.BUY_IN) && (
        <div className="seat__buyin-meta small muted">
          总带入 {seat.totalBuyIn}（补 +{seat.totalBuyIn - TABLE_CONSTANTS.BUY_IN}）
        </div>
      )}

      {!hand && seat.lastAction && (
        <div className="seat__action">{seat.lastAction}</div>
      )}
      {table.result && delta !== 0 && (
        <div className={`seat__delta ${delta > 0 ? 'is-up' : 'is-down'}`}>
          本手 {delta > 0 ? '+' : ''}
          {delta}
        </div>
      )}
      {seat.folded && <div className="seat__folded">已弃牌</div>}
    </div>
  );
}

export function TablePage() {
  const [ui, dispatch] = useReducer(reducer, undefined, () => loadSavedTable());
  const [delay, setDelay] = useState(() => {
    const saved = Number(readSetting(SETTINGS.delay, String(SPEEDS[1].delay)));
    return SPEEDS.some((speed) => speed.delay === saved) ? saved : SPEEDS[1].delay;
  });
  const [showAll, setShowAll] = useState(() => readSetting(SETTINGS.reveal, '0') === '1');
  const [showEquity, setShowEquity] = useState(() => readSetting(SETTINGS.equity, '1') === '1');
  const rngRef = useRef(createRng((Date.now() ^ 0x9e3779b9) >>> 0));

  useEffect(() => writeSetting(SETTINGS.delay, String(delay)), [delay]);
  useEffect(() => writeSetting(SETTINGS.equity, showEquity ? '1' : '0'), [showEquity]);
  useEffect(() => writeSetting(SETTINGS.reveal, showAll ? '1' : '0'), [showAll]);
  useEffect(
    () => writeSetting(SETTINGS.bots, String(ui.table.seats.length - 1)),
    [ui.table.seats.length],
  );

  // 牌局状态与历史自动持久化存储，页面刷新或重新打开时完美还原当前局面
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS.tableState, JSON.stringify(ui.table));
      // 为控制 storage 大小，历史最多保存最近 20 步
      localStorage.setItem(SETTINGS.history, JSON.stringify(ui.history.slice(-20)));
    } catch {
      // 存储满或无权限时静默忽略
    }
  }, [ui.table, ui.history]);

  const { table } = ui;
  const hero = table.seats[0];
  const legal = useMemo(() => legalActions(table, 0), [table]);
  const isHeroTurn = legal.length > 0;
  const toCall = Math.max(0, table.currentBet - hero.committedStreet);
  const opponents = table.seats.filter(
    (seat) => !seat.folded && seat.index !== 0,
  ).length;
  const activeCount = table.seats.filter((seat) => !seat.folded).length;

  const cards = boardKey(table.board);
  const heroCards = hero.hole ? boardKey(hero.hole) : '';
  const equity = useMemo(() => {
    if (!hero.hole || table.result) return null;
    return estimateEquity(hero.hole, table.board, Math.max(1, opponents));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroCards, cards, opponents, table.result]);

  // 深度牌力与对手威胁分析（翻牌后）
  const handAnalysis = useMemo(() => {
    if (!hero.hole || table.board.length < 3) return null;
    const scenario = toScenario(hero.hole, table.board);
    if (!scenario) return null;

    const fiveCard = summarizeFiveCardHand(scenario);
    const scenarioData = analyzeScenario(scenario);
    const drawsAll = analyzeDraws(scenario);

    // 对手所有可能的成牌分布（客观数学统计，不考虑下注）
    const opponentMadeHands = scenarioData.byCategory
      .filter((cat) => cat.totalCount > 0)
      .map((cat) => ({
        category: cat.category,
        label: HAND_CATEGORY_LABELS[cat.category],
        totalCombos: cat.totalCount,
        probability: cat.totalCount / scenarioData.totalOpponentCombos,
        aheadCombos: cat.aheadCount,
        aheadProbability: cat.aheadProbability,
      }))
      .sort((a, b) => b.totalCombos - a.totalCombos);

    // 对手可能的听牌分布（客观数学统计，不考虑下注）
    const opponentDrawRows = drawsAll.opponent.rows;

    // 当前五张成牌评价
    const bestHand = evaluateBestHand([...table.board, ...hero.hole]);

    return {
      fiveCard,
      scenarioData,
      drawData: drawsAll.hero,
      opponentDraws: drawsAll.opponent,
      opponentDrawRows,
      opponentMadeHands,
      bestHand,
    };
  }, [heroCards, cards]);

  // 轮到电脑时按设定速度出牌；若玩家已弃牌，电脑行动自动极速快进（40ms），无需无谓等待。
  // 每次行动叠加 ±30% 的随机思考抖动，避免机器人像节拍器一样整齐划一。
  useEffect(() => {
    if (table.result || table.actor === null) return;
    const actor = table.actor;
    if (table.seats[actor].isHero) return;
    const waitTime = hero.folded
      ? Math.min(40, delay)
      : Math.max(60, Math.round(delay * (0.7 + Math.random() * 0.6)));
    const timer = window.setTimeout(() => {
      const action = decideBotAction(table, actor, rngRef.current);
      dispatch({ type: 'tick', action });
    }, waitTime);
    return () => window.clearTimeout(timer);
  }, [table, delay, hero.folded]);

  const potOdds = toCall > 0 ? toCall / (table.pot + toCall) : 0;
  const { smallBlind: smallBlindIndex, bigBlind: bigBlindIndex } = blindIndices(
    table.seats.length,
    table.button,
  );
  const botCount = table.seats.length - 1;
  const logs = [...table.log].reverse().slice(0, 60);
  const isShowdown = table.result?.kind === 'showdown';

  const startNewGame = (seats: number = table.seats.length) => {
    rngRef.current = createRng((Date.now() ^ 0x1234567) >>> 0);
    dispatch({ type: 'newGame', seed: (Date.now() ^ 0xabcdef) >>> 0, seats });
  };

  const changeBots = (count: number) => {
    if (count === botCount) return;
    startNewGame(count + 1);
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>模拟牌桌</h1>
          <p className="muted">
            <strong>不是标准无限注德州扑克</strong>：{table.seats.length} 人桌（你 +{' '}
            {botCount} 个机器人，人数可以加减），买入上限{' '}
            {TABLE_CONSTANTS.BUY_IN} 筹码，盲注 {TABLE_CONSTANTS.SMALL_BLIND}/
            {TABLE_CONSTANTS.BIG_BLIND}，下注 / 加注只有{' '}
            {TABLE_CONSTANTS.BET_SIZES.join(' / ')} 三档、<strong>{TABLE_BET_CAP} 封顶</strong>
            （档位 = 本街你在自己面前的总投入），{' '}
            <strong>翻牌前禁止全下（ALL IN），翻牌后才能全下（ALL IN）</strong>。
          </p>
        </div>
        <div className="page__header-actions">
          <Link className="button button--ghost" to="/">
            返回训练
          </Link>
          <Link className="button button--ghost" to="/flop-types">
            翻牌牌型图鉴
          </Link>
          <Link className="button button--ghost" to="/table">
            模拟牌桌
          </Link>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => startNewGame()}
          >
            重开牌桌
          </button>
        </div>
      </header>

      <section className="panel table-stage">
        <div className="table-stage__top">
          <div className="table-board">
            {[0, 1, 2, 3, 4].map((index) =>
              table.board[index] ? (
                <CardView
                  key={`${table.board[index].rank}${table.board[index].suit}`}
                  card={table.board[index]}
                  size="lg"
                />
              ) : (
                <span key={`empty-${index}`} className="card card--lg card--empty" />
              ),
            )}
          </div>
          <div className="table-pot">
            <div className="table-pot__main">
              <span className="table-pot__label">底池</span>
              <strong className="table-pot__value">{table.pot}</strong>
            </div>
            <div className="table-pot__meta">
              <span className="street-badge">{TABLE_STREET_LABELS[table.street]}</span>
              <span className="muted small">
                第 {table.handNumber} 手 · 局内 {activeCount} 人
              </span>
              {toCall > 0 && (
                <span className="small table-pot__call-hint">
                  需跟注 {toCall}（赔率 {formatPercent(potOdds, 1)}）
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="seats">
          {table.seats.map((seat) => (
            <SeatCard
              key={seat.index}
              table={table}
              seat={seat}
              reveal={showAll || (isShowdown && !seat.folded)}
              isButton={seat.index === table.button}
              blind={
                seat.index === smallBlindIndex
                  ? 'sb'
                  : seat.index === bigBlindIndex
                    ? 'bb'
                    : null
              }
            />
          ))}
        </div>
      </section>

      <section className="panel table-actions">
        {table.result ? (
          <div className="table-actions__result-box">
            <div className="table-actions__result-header">
              <h2>第 {table.handNumber} 手结算</h2>
              <span className="table-actions__result-badge">{table.result.kind === 'showdown' ? '摊牌' : '全部弃牌'}</span>
            </div>
            <p className="table-result__summary">{table.result.summary}</p>
            <ul className="table-awards">
              {table.result.awards.map((award) => (
                <li key={award.note}>
                  <span className="table-awards__note">{award.note}</span>
                  <span className="table-awards__amount">{award.amount}</span>
                  <span className="muted small">
                    {award.winners
                      .map(
                        (index, position) =>
                          `${table.seats[index].name} +${award.shares[position]}`,
                      )
                      .join(' / ')}
                  </span>
                </li>
              ))}
            </ul>
            <div className="actions table-actions__btns">
              <button
                type="button"
                className="button button--primary"
                onClick={() => dispatch({ type: 'next' })}
              >
                下一手 ▶
              </button>
              {canRebuy(table, 0) && (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => dispatch({ type: 'rebuy' })}
                >
                  补码到 {TABLE_CONSTANTS.BUY_IN}
                </button>
              )}
              <button
                type="button"
                className="button button--ghost"
                disabled={ui.history.length === 0}
                onClick={() => dispatch({ type: 'undo' })}
              >
                ↩ 撤回上一步
              </button>
              <span className="muted small table-actions__stack-hint">
                你的筹码：<strong>{hero.stack}</strong>
                {hero.totalBuyIn > TABLE_CONSTANTS.BUY_IN ? (
                  <span className="table-actions__buyin-total">
                    （本场累计带入：<strong>{hero.totalBuyIn}</strong>，补码 +{hero.totalBuyIn - TABLE_CONSTANTS.BUY_IN}）
                  </span>
                ) : (
                  <span>（本场初始带入：{hero.totalBuyIn || TABLE_CONSTANTS.BUY_IN}）</span>
                )}
                {canRebuy(table, 0) ? ' · 可补码回到 200' : ''}
              </span>
            </div>
          </div>
        ) : isHeroTurn ? (
          <div className="table-actions__hero-box">
            <div className="table-actions__turn-header">
              <h2>轮到你行动</h2>
              <div className="table-actions__turn-meta">
                <span className="table-actions__meta-chip">
                  底池 <strong>{table.pot}</strong>
                </span>
                <span className={`table-actions__meta-chip ${toCall > 0 ? 'table-actions__meta-chip--call' : ''}`}>
                  {toCall > 0 ? `需跟注 ${toCall}` : '无人下注'}
                </span>
                {table.raiseCount > 0 && (
                  <span className="table-actions__meta-chip">
                    已加注 {table.raiseCount}/{TABLE_CONSTANTS.MAX_RAISES_PER_STREET} 次
                  </span>
                )}
              </div>
            </div>
            <div className="table-buttons">
              {legal.map((action) => (
                <button
                  key={`${action.type}-${action.amount ?? 0}`}
                  type="button"
                  className={`button table-button table-button--${action.type}`}
                  title={ACTION_HINTS[action.type]}
                  onClick={() =>
                    dispatch({
                      type: 'hero',
                      action: { type: action.type, amount: action.amount },
                    })
                  }
                >
                  {action.label}
                </button>
              ))}
            </div>
            <div className="table-actions__rules-inline muted small">
              {table.street === 'preflop'
                ? `翻牌前禁止全下：下注/加注档位为 ${TABLE_CONSTANTS.BET_SIZES.join(' / ')}，本街投入 ${TABLE_BET_CAP} 封顶（大盲 10，加注到 ${TABLE_BET_CAP}）。`
                : `翻牌后可全下（不受 ${TABLE_BET_CAP} 封顶限制）。常规下注/加注档位为 ${TABLE_CONSTANTS.BET_SIZES.join(' / ')}，最高加到 ${TABLE_BET_CAP}。`}
            </div>
          </div>
        ) : (
          <div className="table-actions__waiting-box">
            <div className="table-actions__waiting-spinner" />
            <div>
              <h2 className="table-actions__waiting-title">等待电脑玩家行动…</h2>
              <p className="muted small table-actions__waiting-sub">
                {table.actor === null
                  ? '本手结束'
                  : `${table.seats[table.actor].name} 正在思考出牌`}
              </p>
            </div>
          </div>
        )}

        <div className="table-toolbar">
          <div className="table-toolbar__group">
            <span className="table-toolbar__label">人数</span>
            <div className="table-bots">
              {BOT_CHOICES.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={`chip chip--bot ${botCount === count ? 'chip--selected' : ''}`}
                  title={`${count} 个电脑（共 ${count + 1} 人）`}
                  onClick={() => changeBots(count)}
                >
                  {count}人
                </button>
              ))}
            </div>
          </div>

          <div className="table-toolbar__group">
            <span className="table-toolbar__label">速度</span>
            <div className="table-speeds">
              {SPEEDS.map((speed) => (
                <button
                  key={speed.id}
                  type="button"
                  className={`chip ${delay === speed.delay ? 'chip--selected' : ''}`}
                  onClick={() => setDelay(speed.delay)}
                >
                  {speed.label}
                </button>
              ))}
            </div>
          </div>

          <div className="table-toolbar__switches">
            <label className="switch switch--compact table-switch table-switch--equity">
              <input
                type="checkbox"
                checked={showEquity}
                onChange={(event) => setShowEquity(event.target.checked)}
              />
              <span className="switch__track">
                <span className="switch__thumb" />
              </span>
              <span className="switch__label">胜率估计</span>
            </label>
            <label className="switch switch--compact table-switch table-switch--reveal">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
              />
              <span className="switch__track">
                <span className="switch__thumb" />
              </span>
              <span className="switch__label">亮出底牌</span>
            </label>
          </div>

          {ui.history.length > 0 && !table.result && (
            <button
              type="button"
              className="button button--ghost button--tiny table-toolbar__undo"
              onClick={() => dispatch({ type: 'undo' })}
            >
              ↩ 撤回
            </button>
          )}
        </div>
      </section>

      {showEquity && equity && !table.result && (
        <section className="panel table-equity-panel">
          <div className="table-equity-panel__header">
            <h2>你的牌力估计与分析</h2>
            <span className="table-equity-panel__badge">
              {table.board.length < 3
                ? '翻牌前启发式'
                : `基于 ${equity.samples} 种对手组合全枚举`}
            </span>
          </div>

          <div className="table-equity-cards">
            {table.board.length < 3 ? (
              <div className="table-equity-card">
                <span className="table-equity-card__label">起手牌强度</span>
                <strong className="table-equity-card__val pct--info">
                  {formatPercent(equity.made, 1)}
                </strong>
                <span className="table-equity-card__sub">
                  点数/同花/连张综合评级
                </span>
              </div>
            ) : (
              <>
                <div className="table-equity-card">
                  <span className="table-equity-card__label">当前成牌强度</span>
                  <strong className="table-equity-card__val pct--neutral">
                    {formatPercent(equity.made, 1)}
                  </strong>
                  <span className="table-equity-card__sub">
                    打赢随机单人对手的概率
                  </span>
                </div>
                <div className="table-equity-card">
                  <span className="table-equity-card__label">听牌补成期望</span>
                  <strong className="table-equity-card__val pct--safe">
                    {formatPercent(equity.draw, 1)}
                  </strong>
                  <span className="table-equity-card__sub">
                    后续公共牌补成同花/顺子
                  </span>
                </div>
              </>
            )}
            <div className="table-equity-card table-equity-card--highlight">
              <span className="table-equity-card__label">
                综合胜率（对 {Math.max(1, opponents)} 个对手）
              </span>
              <strong className="table-equity-card__val pct--accent">
                {formatPercent(equity.equity, 1)}
              </strong>
              <span className="table-equity-card__sub">
                多路对局估算期望
              </span>
            </div>
            {toCall > 0 && (
              <div className="table-equity-card">
                <span className="table-equity-card__label">所需底池赔率</span>
                <strong className="table-equity-card__val pct--danger">
                  {formatPercent(potOdds, 1)}
                </strong>
                <span className="table-equity-card__sub">
                  需投 {toCall} 争夺 {table.pot + toCall} 底池
                </span>
              </div>
            )}
          </div>

          {handAnalysis && (
            <div className="table-equity-analysis">
              {/* 1. 当前成牌形态 */}
              <div className="table-equity-analysis__section">
                <span className="table-equity-analysis__tag">当前手牌形态</span>
                <div className="table-equity-analysis__body">
                  <strong>{handAnalysis.fiveCard ? handAnalysis.fiveCard.summary : describeHandValue(handAnalysis.bestHand)}</strong>
                  {handAnalysis.fiveCard?.detail && (
                    <span className="muted small">（{handAnalysis.fiveCard.detail}）</span>
                  )}
                </div>
              </div>

              {/* 2. 补牌与听牌明细 (Outs) */}
              {handAnalysis.drawData.rows.length > 0 && (
                <div className="table-equity-analysis__section">
                  <span className="table-equity-analysis__tag">听牌补牌 (Outs)</span>
                  <div className="table-equity-analysis__chips">
                    {handAnalysis.drawData.rows.map((row) => (
                      <span key={row.label} className="table-equity-chip">
                        {row.label}
                        {!row.backdoor && (
                          <span className="table-equity-chip__outs">
                            {row.completion.outs.length} 张 outs
                          </span>
                        )}
                        <span className="table-equity-chip__prob">
                          {formatPercent(row.completion.finalProbability, 1)}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. 对手会有哪些成牌（客观全组合分布，不考虑下注） */}
              {handAnalysis.opponentMadeHands.length > 0 && (
                <div className="table-equity-analysis__section">
                  <div className="table-equity-analysis__section-head">
                    <span className="table-equity-analysis__tag">对手成牌分布（客观底牌全组合）</span>
                    <span className="muted small">不考虑下注行为，基于全部未发手牌统计</span>
                  </div>
                  <div className="table-equity-analysis__grid">
                    {handAnalysis.opponentMadeHands.map((item) => (
                      <div key={item.category} className="table-equity-grid-item">
                        <div className="table-equity-grid-item__top">
                          <span className="table-equity-grid-item__name">{item.label}</span>
                          <span className="table-equity-grid-item__prob">
                            {formatPercent(item.probability, 1)}
                          </span>
                        </div>
                        <div className="table-equity-threat-item__bar-wrap">
                          <span
                            className={`table-equity-threat-item__bar ${item.aheadCombos > 0 ? 'table-equity-threat-item__bar--danger' : 'table-equity-threat-item__bar--safe'}`}
                            style={{ width: `${Math.min(100, item.probability * 100 * 1.5)}%` }}
                          />
                        </div>
                        <div className="table-equity-grid-item__sub muted small">
                          {item.aheadCombos > 0 ? (
                            <span className="text-danger">{item.aheadCombos} 组压制你 ({formatPercent(item.aheadProbability, 1)})</span>
                          ) : (
                            <span className="text-safe">0 组压制（你领先）</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. 对手会有哪些听牌（客观听牌分布，不考虑下注） */}
              {handAnalysis.opponentDrawRows.length > 0 && (
                <div className="table-equity-analysis__section">
                  <div className="table-equity-analysis__section-head">
                    <span className="table-equity-analysis__tag">对手潜在听牌分布</span>
                    <span className="muted small">对手持有顺子/同花听牌的概率与后续补成率</span>
                  </div>
                  <div className="table-equity-analysis__draws-grid">
                    {handAnalysis.opponentDrawRows.map((draw) => (
                      <div key={draw.kind} className="table-equity-draw-card">
                        <div className="table-equity-draw-card__header">
                          <strong className="table-equity-draw-card__title">{draw.label}</strong>
                          <span className="table-equity-draw-card__badge">
                            持有率 {formatPercent(draw.probability, 1)}
                          </span>
                        </div>
                        <div className="table-equity-draw-card__details muted small">
                          <span>包含 {draw.comboCount} 组对手手牌</span>
                          <span>
                            {table.board.length === 3 ? (
                              <>发完补成率 <strong>{formatPercent(draw.averageFinalProbability, 1)}</strong></>
                            ) : (
                              <>河牌补成率 <strong>{formatPercent(draw.averageNextProbability, 1)}</strong></>
                            )}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="muted small table-equity-footer-note">
            {table.board.length < 3
              ? '翻牌前未发公共牌，基于起手牌点数、连张与同花进行概率启发估算。'
              : `翻后数据通过逐一遍历比对剩余 ${equity.samples} 种对手底牌可能生成，包含真实成牌压制比、听牌补牌 outs 及对手领先概率。`}
          </p>
        </section>
      )}

      <section className="panel">
        <h2>牌桌记录</h2>
        <ul className="table-log">
          {logs.map((entry, index) => (
            <li
              key={`${entry.hand}-${index}-${entry.text}`}
              className={
                entry.seat === null
                  ? 'table-log__system'
                  : entry.seat === 0
                    ? 'table-log__hero'
                    : ''
              }
            >
              <span className="table-log__street">
                {TABLE_STREET_LABELS[entry.street]}
              </span>
              {entry.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2 className="tax-note__title">本桌规则</h2>
        <ul className="tax-note">
          <li>
            人数随时可加减：工具栏的「对手数量」可以选 <strong>1 ～ 5 个机器人</strong>
            （也就是 2 ～ 6 人桌）。改变人数会立刻开一桌新的，用 ↩ 撤回上一步可以退回原来那桌。
          </li>
          <li>
            每人最多带 <strong>200 筹码</strong>；筹码低于 20 时，下一手开始前自动补码回 200，
            你也可以在手与手之间手动补码。
          </li>
          <li>
            小盲 5 / 大盲 10，每手轮换庄家；翻牌前从大盲左手边开始，翻牌后从庄家左手边开始。
            两人单挑时庄家下小盲、翻牌前先说话，翻牌后换大盲先说话（标准单挑规则）。
          </li>
          <li>
            <strong>这不是标准无限注德州扑克</strong>，只有两条最重要的改动：下注 / 加注只有{' '}
            <strong>5 / 10 / 20</strong> 三档（<strong>{TABLE_BET_CAP} 封顶</strong>）；
            <strong>翻牌前禁止全下（ALL IN），翻牌后才能全下（ALL IN）</strong>。
          </li>
          <li>
            下注 / 加注的档位指的是<strong>你这一条街在自己面前一共投入多少</strong>，不是「再加多少」，
            所以「{TABLE_BET_CAP}」就是上限：按钮上只会有「下注 10」「加注到 {TABLE_BET_CAP}」，
            不会出现「加注 {TABLE_BET_CAP}（到 {TABLE_BET_CAP + 10}）」。跟注仍然要按对手的下注额补齐（跟注额可以是任何数）。
          </li>
          <li>
            因为 {TABLE_BET_CAP} 封顶之后没人能再加注，一条街最多就是 5 → 10 → 20 三次加注；
            翻牌前大盲已经是 10，所以翻牌前最多只能加到 {TABLE_BET_CAP}（一次）。
            封顶只约束「下注 / 加注」，翻牌后的<strong>梭哈</strong>不受它限制。
          </li>
          <li>
            <strong>翻牌前不能全下（ALL IN）</strong>：加注后必须留至少 1 个筹码；
            翻牌前筹码不够跟注时只能弃牌。
          </li>
          <li>
            <strong>翻牌后可以全下（ALL IN）</strong>：把剩余筹码一次推进去，<strong>不受 {TABLE_BET_CAP} 封顶限制</strong>。
          </li>
          <li>
            摊牌按 7 张牌里最好的 5 张比大小；投入不等的全下按主池 / 边池分配，
            平手平分，除不尽的零头给庄家左手边第一位。
          </li>
          <li>
            电脑玩家具备深度的真人博弈决策模型：涵盖紧凶、松凶、平衡、跟注站、岩石、疯子等真实牌手风格分布，
            掌握位置优势、盲注防守与 3-Bet、翻后持续下注（C-Bet）、听牌半诈唬（Semi-Bluff）、强牌慢打设伏（Trap）、控池与抓诈唬等综合决策能力。
          </li>
        </ul>
      </section>
    </div>
  );
}
