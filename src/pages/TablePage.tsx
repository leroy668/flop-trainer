import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CardView } from '../components/Card';
import { decideBotAction, estimateEquity } from '../poker/ai';
import type { Card as CardType } from '../poker/cards';
import { describeHandValue } from '../poker/evaluator';
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

      <div className="seat__line">
        <span className="muted small">筹码</span>
        <StackValue value={seat.stack} />
        {seat.committedStreet > 0 && (
          <span className="seat__bet">已下 {seat.committedStreet}</span>
        )}
      </div>

      {hand && <div className="seat__hand">{describeHandValue(hand)}</div>}
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
  const [ui, dispatch] = useReducer(reducer, undefined, () => ({
    table: createTable({
      seed: (Date.now() ^ 0x5f3759df) >>> 0,
      seats: readBots() + 1,
    }),
    history: [],
  }));
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

  // 轮到电脑时按当前速度自动出牌。
  useEffect(() => {
    if (table.result || table.actor === null) return;
    const actor = table.actor;
    if (table.seats[actor].isHero) return;
    const timer = window.setTimeout(() => {
      const action = decideBotAction(table, actor, rngRef.current);
      dispatch({ type: 'tick', action });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [table, delay]);

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
            <strong>翻牌前禁止全下，翻牌后才能全下</strong>。
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
            <span className="muted small">底池</span>
            <strong className="table-pot__value">{table.pot}</strong>
            <span className="street-badge">{TABLE_STREET_LABELS[table.street]}</span>
            <span className="muted small">
              第 {table.handNumber} 手 · 还在局里 {activeCount} 人
            </span>
            {toCall > 0 && (
              <span className="muted small">
                轮到你时需跟注 {toCall}（底池赔率 {formatPercent(potOdds, 1)}）
              </span>
            )}
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
          <>
            <h2>第 {table.handNumber} 手结算</h2>
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
            <div className="actions">
              <button
                type="button"
                className="button"
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
            </div>
            <p className="muted small">
              你现在的筹码 {hero.stack}
              {canRebuy(table, 0) ? '（可以补码回到 200）' : ''}
            </p>
          </>
        ) : isHeroTurn ? (
          <>
            <h2>轮到你行动</h2>
            <p className="muted small">
              底池 {table.pot}
              {toCall > 0 ? ` · 需要跟注 ${toCall}` : ' · 无人下注'}
              {table.raiseCount > 0
                ? ` · 本街已加注 ${table.raiseCount}/${TABLE_CONSTANTS.MAX_RAISES_PER_STREET} 次`
                : ''}
            </p>
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
            <div className="actions">
              <span className="muted small">
                {table.street === 'preflop'
                  ? `翻牌前不会出现「全下」：下注 / 加注只有 ${TABLE_CONSTANTS.BET_SIZES.join(
                      ' / ',
                    )} 三档、本街投入 ${TABLE_BET_CAP} 封顶（大盲 10，所以这里只能跟注 10 或直接加到 ${TABLE_BET_CAP}），加注后还必须留至少 1 个筹码。`
                  : `翻牌后可以全下（一次推进全部剩余筹码，不受 ${TABLE_BET_CAP} 封顶限制，也算一次加注）。下注 / 加注档位是 ${TABLE_CONSTANTS.BET_SIZES.join(
                      ' / ',
                    )}，本街最多投入 ${TABLE_BET_CAP}。`}
              </span>
            </div>
          </>
        ) : (
          <>
            <h2>等待电脑玩家行动…</h2>
            <p className="muted small">
              {table.actor === null
                ? '本手结束'
                : `${table.seats[table.actor].name} 正在想`}
            </p>
          </>
        )}

        <div className="table-toolbar">
          <span className="muted small">对手数量</span>
          <span className="table-bots">
            {BOT_CHOICES.map((count) => (
              <button
                key={count}
                type="button"
                className={`chip chip--bot ${botCount === count ? 'chip--selected' : ''}`}
                title={`${count} 个机器人（${count + 1} 人桌）`}
                onClick={() => changeBots(count)}
              >
                {count}
              </button>
            ))}
          </span>
          <span className="muted small table-bots__hint">
            改变人数会立刻重开牌桌（可 ↩ 撤回）
          </span>
          <span className="muted small">电脑思考速度</span>
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
          <label className="switch switch--compact table-switch table-switch--equity">
            <input
              type="checkbox"
              checked={showEquity}
              onChange={(event) => setShowEquity(event.target.checked)}
            />
            <span className="switch__track">
              <span className="switch__thumb" />
            </span>
            <span className="switch__label">显示我的胜率估计</span>
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
            <span className="switch__label">亮出电脑底牌</span>
          </label>
          {ui.history.length > 0 && !table.result && (
            <button
              type="button"
              className="button button--ghost button--tiny"
              onClick={() => dispatch({ type: 'undo' })}
            >
              ↩ 撤回上一步
            </button>
          )}
        </div>
      </section>

      {showEquity && equity && !table.result && (
        <section className="panel">
          <h2>你的牌力估计</h2>
          <div className="table-equity">
            {table.board.length < 3 ? (
              <>
                <span className="table-equity__key">起手牌强度</span>
                <span className="pct pct--md pct--info">
                  {formatPercent(equity.made, 1)}
                </span>
              </>
            ) : (
              <>
                <span className="table-equity__key">当前成牌强度</span>
                <span className="pct pct--md pct--neutral">
                  {formatPercent(equity.made, 1)}
                </span>
                <span className="table-equity__key">听牌补成概率</span>
                <span className="pct pct--md pct--safe">
                  {formatPercent(equity.draw, 1)}
                </span>
              </>
            )}
            <span className="table-equity__key">
              综合胜率（对 {Math.max(1, opponents)} 个对手，粗略估计）
            </span>
            <span className="pct pct--lg pct--danger">
              {formatPercent(equity.equity, 1)}
            </span>
          </div>
          <p className="muted small">
            {table.board.length < 3
              ? '翻牌前没有公共牌，无法枚举摊牌，这里用的是起手牌强度公式（点数、同花、连张），只是启发式估计。'
              : `成牌强度是精确枚举：把对手可能拿到的 C(${
                  52 - 2 - table.board.length
                },2) = ${equity.samples} 种两张手牌全部比一遍，看有多少比例打不过你。`}
            听牌补成概率也是精确值，来自训练器同一套补牌统计；综合胜率则把「每个对手都打不过你」当成独立事件
            （胜率 = 单人胜率 ^ 对手数）。真实的多路胜率会略高一些，尤其是一对、两对这种中等牌，
            所以这个数字只是估计，电脑玩家也是照它来决策的。
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
            <strong>翻牌前禁止全下，翻牌后才能全下</strong>。
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
            <strong>翻牌前不能全下</strong>：加注后必须留至少 1 个筹码；
            翻牌前筹码不够跟注时只能弃牌。
          </li>
          <li>
            <strong>翻牌后可以全下</strong>：把剩余筹码一次推进去，<strong>不受 {TABLE_BET_CAP} 封顶限制</strong>。
          </li>
          <li>
            摊牌按 7 张牌里最好的 5 张比大小；投入不等的全下按主池 / 边池分配，
            平手平分，除不尽的零头给庄家左手边第一位。
          </li>
          <li>
            电脑玩家的决策来自「胜率 vs 底池赔率」，每人有固定的松紧 / 激进度
            （保守、激进、平衡、松凶），带一点随机偷鸡。
          </li>
        </ul>
      </section>
    </div>
  );
}
