/**
 * 4 人模拟牌桌的规则引擎（纯函数，不依赖 React）。
 *
 * 规则（页面上也会写一遍）：
 *   1. 你 + 3 个 AI，每人上桌筹码上限 200（「每次最大 200 筹码」）。
 *   2. 每手开始前，筹码低于 20 的座位自动补码到 200。
 *   3. 小盲 5 / 大盲 10，按手轮换庄家。
 *   4. 下注 / 加注只能用 5 / 10 / 20 三种增量。
 *   5. 每条街最多加注 3 次（全下也算一次加注），之后只能跟注或弃牌。
 *   6. 翻牌前禁止全下：加注后必须至少留 1 个筹码；筹码不足跟注时只能弃牌。
 *   7. 翻牌后可以全下。
 *   8. 河牌摊牌比大小，全下造成的不等额投入按标准边池分配，平手平分，
 *      零头给庄家左手边第一位。
 *
 * 所有函数都不修改传入的 state，而是返回新的 state；
 * 随机性来自 state.rngSeed，因此「同一 state + 同一动作」结果完全可复现。
 */

import type { Card } from './cards';
import { cardKey, createDeck } from './cards';
import type { HandValue } from './evaluator';
import {
  compareHandValue,
  describeHandValue,
  evaluateBestHand,
} from './evaluator';
import type { Rng } from './rng';
import { createRng, shuffleInPlace } from './rng';

export const TABLE_CONSTANTS = {
  /** 座位数（含 Hero）。 */
  SEATS: 4,
  /** 买入 / 补码上限。 */
  BUY_IN: 200,
  SMALL_BLIND: 5,
  BIG_BLIND: 10,
  /** 允许的下注 / 加注增量。 */
  BET_SIZES: [5, 10, 20] as const,
  /** 每条街最多加注次数（全下也算一次）。 */
  MAX_RAISES_PER_STREET: 3,
  /** 低于这个筹码就在下一手开始前自动补码。 */
  AUTO_REBUY_THRESHOLD: 20,
} as const;

export const TABLE_BET_SIZES: readonly number[] = TABLE_CONSTANTS.BET_SIZES;

export type TableStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export const TABLE_STREET_LABELS: Record<TableStreet, string> = {
  preflop: '翻牌前',
  flop: '翻牌圈',
  turn: '转牌圈',
  river: '河牌圈',
  showdown: '摊牌',
};

export interface Seat {
  index: number;
  name: string;
  isHero: boolean;
  stack: number;
  hole: [Card, Card] | null;
  folded: boolean;
  allIn: boolean;
  /** 本街已投入。 */
  committedStreet: number;
  /** 本手累计投入（决定边池）。 */
  committedTotal: number;
  /** 本街是否已经行动过（用于大盲的选择权）。 */
  hasActed: boolean;
  /** 最近一次动作的中文描述，用于界面上的小标签。 */
  lastAction: string | null;
}

export interface LogEntry {
  hand: number;
  street: TableStreet;
  seat: number | null;
  text: string;
}

export interface PotAward {
  /** 这个池子的筹码。 */
  amount: number;
  /** 赢家座位号（可能多个，平手平分）。 */
  winners: number[];
  /** 每人分到的筹码。 */
  shares: number[];
  /** 例如「主池」「边池 1」。 */
  note: string;
}

export interface HandResult {
  kind: 'fold' | 'showdown';
  awards: PotAward[];
  /** 本手账单：每人净变化。 */
  deltas: number[];
  /** 摊牌时的牌力（弃牌 / 未摊牌为 null）。 */
  hands: (HandValue | null)[];
  /** 每个赢家的说明，例如「你 · 两对A K」。 */
  winnerLabels: string[];
  summary: string;
}

export interface TableState {
  handNumber: number;
  /** 庄家座位号。 */
  button: number;
  street: TableStreet;
  seats: Seat[];
  board: Card[];
  deck: Card[];
  /** 底池 = 所有座位本手累计投入之和。 */
  pot: number;
  /** 本街当前需要跟到的额度。 */
  currentBet: number;
  /** 本街已加注次数。 */
  raiseCount: number;
  /** 当前该谁行动（null = 等待发下一手 / 已结束）。 */
  actor: number | null;
  rngSeed: number;
  log: LogEntry[];
  result: HandResult | null;
}

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'allin';

export interface TableAction {
  type: ActionType;
  /** bet = 加注增量；call / allin = 实际投入。 */
  amount?: number;
}

export interface LegalAction extends TableAction {
  label: string;
}

const HERO_NAME = '你';

const BOT_NAMES = ['机器人 A', '机器人 B', '机器人 C', '机器人 D', '机器人 E'];

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

function cloneState(state: TableState): TableState {
  return {
    ...state,
    seats: state.seats.map((seat) => ({ ...seat })),
    board: [...state.board],
    deck: [...state.deck],
    log: [...state.log],
  };
}

function log(
  state: TableState,
  seat: number | null,
  text: string,
): void {
  state.log.push({
    hand: state.handNumber,
    street: state.street,
    seat,
    text,
  });
}

function refreshPot(state: TableState): void {
  state.pot = state.seats.reduce((sum, seat) => sum + seat.committedTotal, 0);
}

function totalChips(state: TableState): number {
  return state.seats.reduce((sum, seat) => sum + seat.stack, 0) + state.pot;
}

/** 座位展示名。 */
export function seatName(state: TableState, index: number): string {
  return state.seats[index]?.name ?? `座位 ${index}`;
}

/** 从 start 之后开始，找第一个还能行动的座位（跳过弃牌与全下）。 */
function nextLiveSeat(
  state: TableState,
  start: number,
  predicate: (seat: Seat) => boolean,
): number | null {
  const count = state.seats.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (start + step) % count;
    const seat = state.seats[index];
    if (!seat.folded && !seat.allIn && predicate(seat)) return index;
  }
  return null;
}

export interface TableOptions {
  seed?: number;
  /** 座位数（含 Hero），默认 4。 */
  seats?: number;
}

/* ------------------------------------------------------------------ */
/* 开局与发牌                                                          */
/* ------------------------------------------------------------------ */

export function createTable(options: TableOptions = {}): TableState {
  const seatCount = Math.max(2, options.seats ?? TABLE_CONSTANTS.SEATS);
  const seats: Seat[] = [];
  for (let i = 0; i < seatCount; i += 1) {
    seats.push({
      index: i,
      name: i === 0 ? HERO_NAME : BOT_NAMES[i - 1] ?? `机器人 ${i}`,
      isHero: i === 0,
      stack: TABLE_CONSTANTS.BUY_IN,
      hole: null,
      folded: false,
      allIn: false,
      committedStreet: 0,
      committedTotal: 0,
      hasActed: false,
      lastAction: null,
    });
  }

  const state: TableState = {
    handNumber: 0,
    // 这样第一手牌庄家就是 0 号位（你）。
    button: seatCount - 1,
    street: 'preflop',
    seats,
    board: [],
    deck: [],
    pot: 0,
    currentBet: 0,
    raiseCount: 0,
    actor: null,
    rngSeed: (options.seed ?? Date.now()) >>> 0,
    log: [],
    result: null,
  };

  return startHand(state);
}

/** 开始新的一手：补码、转庄、洗牌发牌、下盲注。 */
export function startHand(state: TableState): TableState {
  const next = cloneState(state);
  const rng: Rng = createRng(next.rngSeed);

  next.handNumber += 1;
  next.street = 'preflop';
  next.board = [];
  next.pot = 0;
  next.currentBet = 0;
  next.raiseCount = 0;
  next.actor = null;
  next.result = null;
  next.log = [];

  for (const seat of next.seats) {
    seat.hole = null;
    seat.folded = false;
    seat.allIn = false;
    seat.committedStreet = 0;
    seat.committedTotal = 0;
    seat.hasActed = false;
    seat.lastAction = null;
  }

  log(next, null, `—— 第 ${next.handNumber} 手 ——`);

  // 补码：筹码太少的座位自动补到买入上限，避免出现「盲注都下不起」的局面。
  for (const seat of next.seats) {
    if (seat.stack < TABLE_CONSTANTS.AUTO_REBUY_THRESHOLD) {
      const added = TABLE_CONSTANTS.BUY_IN - seat.stack;
      seat.stack = TABLE_CONSTANTS.BUY_IN;
      log(next, seat.index, `${seat.name} 补码 ${added} 筹码（回到 ${TABLE_CONSTANTS.BUY_IN}）`);
    }
  }

  next.button = (next.button + 1) % next.seats.length;

  // 洗牌并逐张发牌（每人两张，两圈）。
  next.deck = shuffleInPlace(createDeck(), rng);
  const dealOrder: number[] = [];
  for (let step = 0; step < next.seats.length; step += 1) {
    dealOrder.push((next.button + 1 + step) % next.seats.length);
  }
  const dealt = new Map<number, Card[]>();
  for (let round = 0; round < 2; round += 1) {
    for (const index of dealOrder) {
      const cards = dealt.get(index) ?? [];
      cards.push(next.deck.pop()!);
      dealt.set(index, cards);
    }
  }
  for (const [index, cards] of dealt) {
    next.seats[index].hole = [cards[0], cards[1]];
  }

  const smallBlindIndex = (next.button + 1) % next.seats.length;
  const bigBlindIndex = (next.button + 2) % next.seats.length;

  const smallBlind = Math.min(TABLE_CONSTANTS.SMALL_BLIND, next.seats[smallBlindIndex].stack);
  const bigBlind = Math.min(TABLE_CONSTANTS.BIG_BLIND, next.seats[bigBlindIndex].stack);

  commit(next.seats[smallBlindIndex], smallBlind);
  commit(next.seats[bigBlindIndex], bigBlind);
  next.seats[smallBlindIndex].lastAction = `小盲 ${smallBlind}`;
  next.seats[bigBlindIndex].lastAction = `大盲 ${bigBlind}`;
  next.currentBet = Math.max(smallBlind, bigBlind);
  refreshPot(next);

  log(next, smallBlindIndex, `${seatName(next, smallBlindIndex)} 下小盲 ${smallBlind}`);
  log(next, bigBlindIndex, `${seatName(next, bigBlindIndex)} 下大盲 ${bigBlind}`);

  // 翻牌前从大盲左手边第一位开始；大盲保留一次选择权（hasActed=false）。
  next.actor = (bigBlindIndex + 1) % next.seats.length;
  next.rngSeed = rng.seed;
  return next;
}

function commit(seat: Seat, amount: number): void {
  const paid = Math.min(amount, seat.stack);
  seat.stack -= paid;
  seat.committedStreet += paid;
  seat.committedTotal += paid;
  if (seat.stack === 0) seat.allIn = true;
}

/* ------------------------------------------------------------------ */
/* 合法动作                                                            */
/* ------------------------------------------------------------------ */

/**
 * 当前座位可以做的动作。只在该座位行动时返回非空。
 * 界面按钮与机器人决策都走这一个函数，保证永远不会产生非法动作。
 */
export function legalActions(state: TableState, seatIndex: number): LegalAction[] {
  const seat = state.seats[seatIndex];
  if (!seat) return [];
  if (state.result || state.actor !== seatIndex) return [];
  if (seat.folded || seat.allIn) return [];

  const actions: LegalAction[] = [];
  const toCall = Math.max(0, state.currentBet - seat.committedStreet);
  const isPreflop = state.street === 'preflop';
  const canRaise = state.raiseCount < TABLE_CONSTANTS.MAX_RAISES_PER_STREET;
  const raiseWord = state.currentBet > 0 ? '加注' : '下注';

  actions.push({ type: 'fold', label: '弃牌' });

  if (toCall === 0) {
    actions.push({ type: 'check', label: '过牌' });
  } else if (seat.stack > toCall || !isPreflop) {
    const paid = Math.min(toCall, seat.stack);
    actions.push({
      type: 'call',
      amount: paid,
      label: paid >= seat.stack ? `跟注 ${paid}（全下）` : `跟注 ${paid}`,
    });
  }

  // 翻牌前不能全下，所以加注后必须留至少 1 个筹码。
  if (canRaise) {
    for (const size of TABLE_CONSTANTS.BET_SIZES) {
      const total = toCall + size;
      const affordable = isPreflop ? total < seat.stack : total <= seat.stack;
      if (!affordable) continue;
      actions.push({
        type: 'bet',
        amount: size,
        label: `${raiseWord} ${size}（到 ${seat.committedStreet + total}）`,
      });
    }
  }

  if (!isPreflop && canRaise && seat.stack > toCall) {
    actions.push({ type: 'allin', amount: seat.stack, label: `全下 ${seat.stack}` });
  }

  return actions;
}

export function findLegalAction(
  state: TableState,
  seatIndex: number,
  action: TableAction,
): LegalAction | null {
  const legal = legalActions(state, seatIndex);
  return (
    legal.find(
      (candidate) =>
        candidate.type === action.type &&
        // 省略 amount 时取该类型的第一个选项（跟注 / 全下的金额由引擎自己算）。
        (action.amount === undefined || candidate.amount === action.amount),
    ) ?? null
  );
}

/* ------------------------------------------------------------------ */
/* 应用动作                                                            */
/* ------------------------------------------------------------------ */

export function applyAction(
  state: TableState,
  seatIndex: number,
  action: TableAction,
): TableState {
  const legal = findLegalAction(state, seatIndex, action);
  if (!legal) {
    throw new Error(
      `非法动作：座位 ${seatIndex} 不能在 ${state.street} 做 ${action.type} ${action.amount ?? ''}`,
    );
  }

  const next = cloneState(state);
  const seat = next.seats[seatIndex];
  const toCall = Math.max(0, next.currentBet - seat.committedStreet);

  switch (legal.type) {
    case 'fold': {
      seat.folded = true;
      seat.hasActed = true;
      seat.lastAction = '弃牌';
      log(next, seatIndex, `${seat.name} 弃牌`);
      break;
    }
    case 'check': {
      seat.hasActed = true;
      seat.lastAction = '过牌';
      log(next, seatIndex, `${seat.name} 过牌`);
      break;
    }
    case 'call': {
      const paid = legal.amount ?? toCall;
      commit(seat, paid);
      seat.hasActed = true;
      seat.lastAction = seat.allIn ? `跟注 ${paid}（全下）` : `跟注 ${paid}`;
      log(
        next,
        seatIndex,
        `${seat.name} ${seat.allIn ? `跟注 ${paid} 全下` : `跟注 ${paid}`}`,
      );
      break;
    }
    case 'bet': {
      const increment = legal.amount ?? 0;
      commit(seat, toCall + increment);
      seat.hasActed = true;
      seat.lastAction = `${next.currentBet > 0 ? '加注' : '下注'} 到 ${seat.committedStreet}`;
      next.currentBet = seat.committedStreet;
      next.raiseCount += 1;
      resetActedExcept(next, seatIndex);
      log(
        next,
        seatIndex,
        `${seat.name} ${state.currentBet > 0 ? '加注' : '下注'} 到 ${seat.committedStreet}（+${increment}）`,
      );
      break;
    }
    case 'allin': {
      commit(seat, seat.stack);
      seat.hasActed = true;
      seat.lastAction = `全下 ${seat.committedStreet}`;
      if (seat.committedStreet > next.currentBet) {
        next.currentBet = seat.committedStreet;
        next.raiseCount += 1;
      }
      resetActedExcept(next, seatIndex);
      log(next, seatIndex, `${seat.name} 全下 ${seat.committedStreet}`);
      break;
    }
  }

  refreshPot(next);
  return advance(next);
}

/** 有人加注后，其他还能行动的座位需要重新表态。 */
function resetActedExcept(state: TableState, raiser: number): void {
  for (const seat of state.seats) {
    if (seat.index === raiser || seat.folded || seat.allIn) continue;
    seat.hasActed = false;
  }
}

function roundComplete(state: TableState): boolean {
  const live = state.seats.filter((seat) => !seat.folded);
  if (live.length <= 1) return true;
  const canAct = live.filter((seat) => !seat.allIn);
  return canAct.every(
    (seat) => seat.hasActed && seat.committedStreet === state.currentBet,
  );
}

/** 结算本街、发牌、进入下一街，直到需要某人行动或者本手结束。 */
function advance(state: TableState): TableState {
  let next = state;

  for (;;) {
    const live = next.seats.filter((seat) => !seat.folded);
    if (live.length <= 1) return finishByFold(next);
    if (!roundComplete(next)) {
      next.actor = nextLiveSeat(
        next,
        next.actor ?? next.button,
        (seat) => !seat.hasActed || seat.committedStreet < next.currentBet,
      );
      if (next.actor === null) {
        // 理论上不会发生：回合未结束却没人能行动。
        next.actor = null;
      }
      return next;
    }

    if (next.street === 'river') return resolveShowdown(next);

    const canAct = next.seats.filter((seat) => !seat.folded && !seat.allIn);

    // 收集本街，公共牌归零。
    for (const seat of next.seats) {
      seat.committedStreet = 0;
      seat.hasActed = false;
      seat.lastAction = null;
    }
    next.currentBet = 0;
    next.raiseCount = 0;

    if (canAct.length <= 1) {
      // 都全下了（或者只剩一个人还能行动但没人能跟），直接发完摊牌。
      while (next.board.length < 5) next.board.push(next.deck.pop()!);
      next.street = 'river';
      log(next, null, '所有人都已全下，直接发完公共牌摊牌');
      return resolveShowdown(next);
    }

    next.street = next.street === 'preflop' ? 'flop' : next.street === 'flop' ? 'turn' : 'river';
    const count = next.street === 'flop' ? 3 : 1;
    const dealt: Card[] = [];
    for (let i = 0; i < count; i += 1) dealt.push(next.deck.pop()!);
    next.board.push(...dealt);
    log(
      next,
      null,
      `${TABLE_STREET_LABELS[next.street]}：${dealt.map((card) => cardKey(card)).join(' ')}`,
    );

    next.actor = firstToActPostflop(next);
    if (next.actor === null) {
      // 没人能行动（极少见），直接继续结算。
      continue;
    }
    return next;
  }
}

/** 翻牌后从庄家左手边第一位开始。 */
function firstToActPostflop(state: TableState): number | null {
  return nextLiveSeat(state, state.button, () => true);
}

/* ------------------------------------------------------------------ */
/* 结算                                                                */
/* ------------------------------------------------------------------ */

function finishByFold(state: TableState): TableState {
  const next = cloneState(state);
  const winner = next.seats.find((seat) => !seat.folded)!;
  const amount = next.pot;
  // `|| 0` 是为了避免 -0 出现在账单里。
  const deltas = next.seats.map((seat) => -seat.committedTotal || 0);
  deltas[winner.index] += amount;
  winner.stack += amount;
  next.pot = 0;

  next.street = 'showdown';
  next.actor = null;
  next.result = {
    kind: 'fold',
    awards: [{ amount, winners: [winner.index], shares: [amount], note: '底池' }],
    deltas,
    hands: next.seats.map(() => null),
    winnerLabels: [`${winner.name} · 其他人弃牌`],
    summary: `${winner.name} 让其他人弃牌，赢下 ${amount} 筹码`,
  };
  log(next, null, `${winner.name} 赢下 ${amount}（其他人弃牌）`);
  return next;
}

interface PotLevel {
  amount: number;
  eligible: number[];
  note: string;
}

/** 按累计投入分层，生成主池与边池。 */
function buildPots(state: TableState): PotLevel[] {
  const levels = [...new Set(state.seats.map((seat) => seat.committedTotal))]
    .filter((value) => value > 0)
    .sort((a, b) => a - b);

  const pots: PotLevel[] = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    for (const seat of state.seats) {
      amount += Math.max(0, Math.min(seat.committedTotal, level) - previous);
    }
    const eligible = state.seats
      .filter((seat) => !seat.folded && seat.committedTotal >= level)
      .map((seat) => seat.index);
    if (amount > 0 && eligible.length > 0) {
      pots.push({
        amount,
        eligible,
        note: pots.length === 0 ? '主池' : `边池 ${pots.length}`,
      });
    }
    previous = level;
  }
  return pots;
}

/** 把「谁赢了哪个池」合并成人话；同一人赢多个池时写成「主池 + 边池 1」。 */
function summarizeShowdown(
  state: TableState,
  awards: readonly PotAward[],
  hands: readonly (HandValue | null)[],
): string {
  const parts: string[] = [];
  const notesBySeat = new Map<number, string[]>();
  for (const award of awards) {
    if (award.winners.length === 0) continue;
    if (award.winners.length > 1) {
      parts.push(
        `${award.winners.map((index) => state.seats[index].name).join('、')} 平分 ${award.note}`,
      );
      continue;
    }
    const index = award.winners[0];
    const notes = notesBySeat.get(index) ?? [];
    notes.push(award.note);
    notesBySeat.set(index, notes);
  }
  for (const [index, notes] of notesBySeat) {
    const hand = hands[index];
    const detail = hand ? `（${describeHandValue(hand)}）` : '';
    parts.push(`${state.seats[index].name} 赢得 ${notes.join(' + ')}${detail}`);
  }
  return parts.join('；');
}

function resolveShowdown(state: TableState): TableState {
  const next = cloneState(state);
  const board = next.board;
  const hands = next.seats.map((seat) =>
    seat.folded || !seat.hole ? null : evaluateBestHand([...board, ...seat.hole]),
  );

  const deltas = next.seats.map((seat) => -seat.committedTotal || 0);
  const awards: PotAward[] = [];
  const winnerLabels: string[] = [];

  for (const pot of buildPots(next)) {
    let best: HandValue | null = null;
    let winners: number[] = [];
    for (const index of pot.eligible) {
      const hand = hands[index];
      if (!hand) continue;
      if (!best) {
        best = hand;
        winners = [index];
        continue;
      }
      const comparison = compareHandValue(hand, best);
      if (comparison > 0) {
        best = hand;
        winners = [index];
      } else if (comparison === 0) {
        winners.push(index);
      }
    }
    if (winners.length === 0) continue;

    const base = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - base * winners.length;
    // 零头按庄家左手边顺序发给赢家。
    const ordered = [...winners].sort(
      (a, b) =>
        ((a - next.button - 1 + next.seats.length) % next.seats.length) -
        ((b - next.button - 1 + next.seats.length) % next.seats.length),
    );
    const shares = new Array(winners.length).fill(base);
    for (let i = 0; i < ordered.length && remainder > 0; i += 1) {
      shares[winners.indexOf(ordered[i])] += 1;
      remainder -= 1;
    }

    for (let i = 0; i < winners.length; i += 1) {
      deltas[winners[i]] += shares[i];
      next.seats[winners[i]].stack += shares[i];
    }

    awards.push({ amount: pot.amount, winners: [...winners], shares, note: pot.note });
    for (let i = 0; i < winners.length; i += 1) {
      const seat = next.seats[winners[i]];
      const hand = hands[winners[i]]!;
      winnerLabels.push(`${seat.name} · ${describeHandValue(hand)}`);
    }
    log(
      next,
      null,
      `${pot.note} ${pot.amount} → ${winners.map((index) => next.seats[index].name).join(' / ')}（${describeHandValue(best!)}）`,
    );
  }

  next.street = 'showdown';
  next.actor = null;
  next.pot = 0;
  next.result = {
    kind: 'showdown',
    awards,
    deltas,
    hands,
    winnerLabels,
    summary: `摊牌：${summarizeShowdown(next, awards, hands)}`,
  };
  log(next, null, `本手结算完成：${next.result.summary}`);
  return next;
}

/* ------------------------------------------------------------------ */
/* 补码                                                                */
/* ------------------------------------------------------------------ */

/** 补码：把某个座位的筹码补到买入上限（只在本手结束后有效）。 */
export function rebuy(state: TableState, seatIndex: number): TableState {
  if (!state.result) return state;
  const seat = state.seats[seatIndex];
  if (!seat || seat.stack >= TABLE_CONSTANTS.BUY_IN) return state;
  const next = cloneState(state);
  const target = next.seats[seatIndex];
  const added = TABLE_CONSTANTS.BUY_IN - target.stack;
  target.stack = TABLE_CONSTANTS.BUY_IN;
  log(next, seatIndex, `${target.name} 补码 ${added} 筹码（回到 ${TABLE_CONSTANTS.BUY_IN}）`);
  next.rngSeed = state.rngSeed;
  return next;
}

export function canRebuy(state: TableState, seatIndex: number): boolean {
  const seat = state.seats[seatIndex];
  return Boolean(state.result) && Boolean(seat) && seat.stack < TABLE_CONSTANTS.BUY_IN;
}

/* ------------------------------------------------------------------ */
/* 展示辅助                                                            */
/* ------------------------------------------------------------------ */

export function activeSeats(state: TableState): Seat[] {
  return state.seats.filter((seat) => !seat.folded);
}

export function potsPreview(state: TableState): { note: string; amount: number; eligible: number[] }[] {
  const pots = buildPots(state);
  // 还没结算时，用当前投入预览一下池子大小。
  if (pots.length === 0 && state.pot > 0) {
    return [{ note: '底池', amount: state.pot, eligible: activeSeats(state).map((s) => s.index) }];
  }
  return pots;
}

/** 本手账单里最大的赢家 / 输家，用于结果条。 */
export function handDeltaSummary(result: HandResult): string {
  const best = Math.max(...result.deltas);
  const worst = Math.min(...result.deltas);
  return `最大赢 ${best >= 0 ? '+' : ''}${best} / 最大输 ${worst}`;
}

export function totalChipsOnTable(state: TableState): number {
  return totalChips(state);
}
