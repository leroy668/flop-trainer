import { describe, expect, it } from 'vitest';

import { cards } from './helpers';
import { decideBotAction } from '../src/poker/ai';
import { describeHandValue } from '../src/poker/evaluator';
import { createRng } from '../src/poker/rng';
import {
  TABLE_CONSTANTS,
  applyAction,
  canRebuy,
  createTable,
  findLegalAction,
  legalActions,
  rebuy,
  startHand,
  totalChipsOnTable,
  type Seat,
  type TableState,
} from '../src/poker/table';

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function clone(state: TableState): TableState {
  return {
    ...state,
    seats: state.seats.map((seat) => ({ ...seat })),
    board: [...state.board],
    deck: [...state.deck],
    log: [...state.log],
  };
}

/** 把某个座位改成指定筹码（模拟被掏空 / 短筹码）。 */
function withStack(state: TableState, index: number, stack: number): TableState {
  const next = clone(state);
  next.seats[index].stack = stack;
  next.seats[index].allIn = stack === 0;
  return next;
}

interface RiggedSeat {
  hole: string | null;
  committedTotal: number;
  stack?: number;
  folded?: boolean;
}

/** 手工摆一个「河牌圈、无人再需要行动」的局面，用来直接验证摊牌结算。 */
function riverState(seats: RiggedSeat[], board: string, button = 0): TableState {
  const base = createTable({ seed: 7 });
  const next = clone(base);
  const boardCards = cards(board);
  next.board = boardCards;
  next.street = 'river';
  next.pot = seats.reduce((sum, seat) => sum + seat.committedTotal, 0);
  next.currentBet = 0;
  next.raiseCount = 0;
  next.result = null;
  next.log = [];
  next.actor = null;

  next.seats.forEach((seat, index) => {
    const rigged = seats[index];
    const parsed = rigged.hole ? cards(rigged.hole) : null;
    seat.hole = parsed ? [parsed[0], parsed[1]] : null;
    seat.committedTotal = rigged.committedTotal;
    seat.committedStreet = 0;
    seat.folded = Boolean(rigged.folded) || rigged.hole === null;
    // 摆好的局面里，底池完全由 committedTotal 决定，筹码只是账单展示用。
    seat.stack =
      rigged.stack ?? Math.max(0, TABLE_CONSTANTS.BUY_IN - rigged.committedTotal);
    seat.allIn = false;
    seat.hasActed = true;
    seat.lastAction = null;
  });
  next.button = button;
  next.pot = seats.reduce((sum, seat) => sum + seat.committedTotal, 0);
  return next;
}

/** 从河牌局面触发结算（让第一个还能行动的座位过牌）。 */
function settle(state: TableState): TableState {
  const actor = state.seats.find((seat) => !seat.folded && !seat.allIn)!.index;
  const next = clone(state);
  next.actor = actor;
  next.seats[actor].hasActed = false;
  return applyAction(next, actor, { type: 'check' });
}

function actionTypes(state: TableState, seat: number): string[] {
  return legalActions(state, seat).map((action) => action.type);
}

/* ------------------------------------------------------------------ */
/* 开局                                                                */
/* ------------------------------------------------------------------ */

describe('牌桌开局', () => {
  it('4 个座位、每人 200 筹码、第一手庄家是自己', () => {
    const state = createTable({ seed: 1 });
    expect(state.seats).toHaveLength(4);
    // 盲注已经扣掉，坐在桌面上的筹码 = 手上 + 本街已投入。
    expect(state.seats.map((seat) => seat.stack + seat.committedStreet)).toEqual([
      200, 200, 200, 200,
    ]);
    expect(state.seats.map((seat) => seat.stack)).toEqual([200, 195, 190, 200]);
    expect(state.seats[0].isHero).toBe(true);
    expect(state.seats[0].name).toBe('你');
    expect(state.handNumber).toBe(1);
    expect(state.button).toBe(0);
    expect(state.street).toBe('preflop');
    expect(state.board).toEqual([]);
  });

  it('小盲 5 大盲 10，翻牌前从大盲左手边开始', () => {
    const state = createTable({ seed: 1 });
    // 庄家 0 → 小盲 1，大盲 2，第一个行动 3。
    expect(state.seats[1].committedStreet).toBe(5);
    expect(state.seats[2].committedStreet).toBe(10);
    expect(state.currentBet).toBe(10);
    expect(state.pot).toBe(15);
    expect(state.actor).toBe(3);
  });

  it('每人两张底牌，整副牌不重复', () => {
    const state = createTable({ seed: 42 });
    const keys = new Set<string>();
    for (const seat of state.seats) {
      expect(seat.hole).not.toBeNull();
      for (const card of seat.hole!) keys.add(`${card.rank}${card.suit}`);
    }
    for (const card of state.deck) keys.add(`${card.rank}${card.suit}`);
    expect(keys.size).toBe(52);
    expect(state.deck).toHaveLength(52 - 8);
  });

  it('同一颗种子发出同一手牌', () => {
    const a = createTable({ seed: 2024 });
    const b = createTable({ seed: 2024 });
    expect(JSON.stringify(a.seats.map((seat) => seat.hole))).toEqual(
      JSON.stringify(b.seats.map((seat) => seat.hole)),
    );
  });

  it('庄家按手轮换', () => {
    let state = createTable({ seed: 5 });
    const buttons = [state.button];
    for (let i = 0; i < 5; i += 1) {
      state = startHand(state);
      buttons.push(state.button);
    }
    expect(buttons).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('筹码低于 20 的座位在下一手自动补码到 200', () => {
    const state = withStack(createTable({ seed: 3 }), 2, 12);
    const next = startHand({ ...state, result: null } as TableState);
    expect(next.seats[2].stack).toBeGreaterThanOrEqual(200 - TABLE_CONSTANTS.BIG_BLIND);
    expect(next.log.some((entry) => entry.seat === 2 && entry.text.includes('补码'))).toBe(
      true,
    );
  });
});

/* ------------------------------------------------------------------ */
/* 合法动作                                                            */
/* ------------------------------------------------------------------ */

describe('动作合法性', () => {
  it('翻牌前的下注按钮只有 5 / 10 / 20，没有全下', () => {
    const state = createTable({ seed: 1 });
    const legal = legalActions(state, 3);
    expect(legal.filter((action) => action.type === 'bet').map((action) => action.amount)).toEqual([
      5, 10, 20,
    ]);
    expect(actionTypes(state, 3)).not.toContain('allin');
    expect(legal[0].type).toBe('fold');
    expect(legal.some((action) => action.type === 'call' && action.amount === 10)).toBe(true);
  });

  it('翻牌前筹码不足以跟注时只能弃牌', () => {
    const state = withStack(createTable({ seed: 1 }), 3, 8);
    expect(actionTypes(state, 3)).toEqual(['fold']);
  });

  it('翻牌后可以全下', () => {
    let state = createTable({ seed: 11 });
    // 一路过牌 / 跟注到翻牌圈。
    while (state.street === 'preflop') {
      const seat = state.actor!;
      const legal = legalActions(state, seat);
      const call = legal.find((action) => action.type === 'call');
      const check = legal.find((action) => action.type === 'check');
      state = applyAction(state, seat, call ?? check!);
    }
    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);
    expect(actionTypes(state, state.actor!)).toContain('allin');
  });

  it('每条街最多加注 3 次，之后只能跟注或弃牌', () => {
    let state = createTable({ seed: 2 });
    expect(state.actor).toBe(3);
    state = applyAction(state, 3, { type: 'bet', amount: 10 });
    expect(state.raiseCount).toBe(1);
    state = applyAction(state, 0, { type: 'bet', amount: 10 });
    expect(state.raiseCount).toBe(2);
    state = applyAction(state, 1, { type: 'bet', amount: 10 });
    expect(state.raiseCount).toBe(3);
    const types = actionTypes(state, 2);
    expect(types).not.toContain('bet');
    expect(types).not.toContain('allin');
    expect(types).toContain('call');
    expect(types).toContain('fold');
  });

  it('加注金额只能是自己面前的增量 5 / 10 / 20', () => {
    const state = createTable({ seed: 2 });
    const raise = legalActions(state, 3).find(
      (action) => action.type === 'bet' && action.amount === 10,
    )!;
    const next = applyAction(state, 3, raise);
    expect(next.seats[3].committedStreet).toBe(20);
    expect(next.currentBet).toBe(20);
    expect(next.seats[3].stack).toBe(180);
  });

  it('非法动作会被拒绝', () => {
    const state = createTable({ seed: 2 });
    expect(() => applyAction(state, 3, { type: 'check' })).toThrow();
    expect(() => applyAction(state, 3, { type: 'allin', amount: 200 })).toThrow();
    expect(() => applyAction(state, 0, { type: 'fold' })).toThrow();
    expect(findLegalAction(state, 3, { type: 'bet', amount: 25 })).toBeNull();
  });

  it('加注后其他座位要重新表态，大盲保留选择权', () => {
    let state = createTable({ seed: 2 });
    // 3 号位跟注，0 号位跟注，1 号位（小盲）跟注 → 轮到大盲 2 号位。
    state = applyAction(state, 3, { type: 'call' });
    state = applyAction(state, 0, { type: 'call' });
    state = applyAction(state, 1, { type: 'call' });
    expect(state.actor).toBe(2);
    // 大盲即使已经投入 10，也还能选择过牌或加注。
    expect(actionTypes(state, 2)).toEqual(expect.arrayContaining(['check', 'bet']));
    state = applyAction(state, 2, { type: 'check' });
    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);
    // 翻牌后从庄家左手边开始。
    expect(state.actor).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 结算                                                                */
/* ------------------------------------------------------------------ */

describe('结算', () => {
  it('其他人都弃牌时直接赢下底池，不摊牌', () => {
    let state = createTable({ seed: 4 });
    state = applyAction(state, 3, { type: 'fold' });
    state = applyAction(state, 0, { type: 'fold' });
    state = applyAction(state, 1, { type: 'fold' });
    expect(state.result?.kind).toBe('fold');
    expect(state.result?.awards[0].amount).toBe(15);
    expect(state.result?.awards[0].winners).toEqual([2]);
    expect(state.seats[2].stack).toBe(205);
    expect(state.seats[1].stack).toBe(195);
    expect(state.pot).toBe(0);
  });

  it('摊牌比大小：三条 > 两对', () => {
    const state = riverState(
      [
        { hole: 'As Ac', committedTotal: 200 },
        { hole: 'Kh Kd', committedTotal: 200 },
        { hole: null, committedTotal: 0, folded: true },
        { hole: null, committedTotal: 0, folded: true },
      ],
      'Ah 9d 8s 4c 2h',
    );
    const settled = settle(state);
    expect(settled.result?.kind).toBe('showdown');
    expect(settled.result?.deltas).toEqual([200, -200, 0, 0]);
    // 筹码变化必须和账单一致。
    settled.seats.forEach((seat, index) => {
      expect(seat.stack).toBe(TABLE_CONSTANTS.BUY_IN + settled.result!.deltas[index]);
    });
    expect(settled.result?.awards[0].winners).toEqual([0]);
    expect(settled.result?.winnerLabels[0]).toContain('三条');
  });

  it('全下不足额时按主池 / 边池分配', () => {
    // 座位 0 只带了 50 全下，座位 3 弃牌前投入 30，
    // 于是底池分成三层：30 × 4 / 20 × 3 / 150 × 2。
    const state = riverState(
      [
        { hole: 'As Ac', committedTotal: 50 },
        { hole: '8h 8d', committedTotal: 200 },
        { hole: '9h 9c', committedTotal: 200 },
        { hole: '5s 4s', committedTotal: 30, folded: true },
      ],
      'Ah 2d 3c 8s 9d',
    );
    const settled = settle(state);
    const awards = settled.result!.awards;
    expect(awards.map((award) => [award.note, award.amount, award.winners])).toEqual([
      ['主池', 120, [0]],
      ['边池 1', 60, [0]],
      ['边池 2', 300, [2]],
    ]);
    expect(awards.reduce((sum, award) => sum + award.amount, 0)).toBe(480);
    expect(settled.result?.deltas).toEqual([130, -200, 100, -30]);
    expect(settled.pot).toBe(0);
    // 同一人赢多个池时，结算文案要合并成一句。
    expect(settled.result?.summary).toBe(
      `摊牌：${settled.seats[0].name} 赢得 主池 + 边池 1（${describeHandValue(
        settled.result!.hands[0]!,
      )}）；${settled.seats[2].name} 赢得 边池 2（${describeHandValue(
        settled.result!.hands[2]!,
      )}）`,
    );
  });

  it('平手平分，零头给庄家左手边第一位', () => {
    const state = riverState(
      [
        { hole: null, committedTotal: 5, folded: true },
        { hole: 'Ah Kd', committedTotal: 10 },
        { hole: 'As Kc', committedTotal: 10 },
        { hole: null, committedTotal: 0, folded: true },
      ],
      '2c 7d 9h Js Qc',
      0,
    );
    const settled = settle(state);
    // 座位 1 / 2 都是 A 高牌（公共牌），平分 25：13 / 12。
    // 主池 15 平分给两家（零头 8 给庄家左手边第一位座位 1），边池 10 各 5。
    expect(
      settled.result!.awards.map((award) => [award.note, award.amount, award.winners, award.shares]),
    ).toEqual([
      ['主池', 15, [1, 2], [8, 7]],
      ['边池 1', 10, [1, 2], [5, 5]],
    ]);
    expect(settled.result!.summary).toContain('平分 主池');
    expect(settled.result!.summary).toContain('平分 边池 1');
    expect(settled.result!.deltas[1]).toBe(3);
    expect(settled.result!.deltas[2]).toBe(2);
    expect(settled.result!.deltas.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('一手之内筹码守恒', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      let state = createTable({ seed });
      const total = totalChipsOnTable(state);
      for (let guard = 0; state.actor !== null && guard < 200; guard += 1) {
        state = applyAction(state, state.actor, { type: 'fold' });
      }
      expect(totalChipsOnTable(state)).toBe(total);
      expect(state.result).not.toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 补码                                                                */
/* ------------------------------------------------------------------ */

describe('补码', () => {
  it('牌局进行中不能补码，本手结束后可以补回 200', () => {
    let state = createTable({ seed: 6 });
    expect(canRebuy(state, 0)).toBe(false);
    for (let guard = 0; state.actor !== null && guard < 200; guard += 1) {
      state = applyAction(state, state.actor, { type: 'fold' });
    }
    const broke = state.seats.findIndex((seat) => seat.stack < 200);
    if (broke >= 0) {
      expect(canRebuy(state, broke)).toBe(true);
      const topped = rebuy(state, broke);
      expect(topped.seats[broke].stack).toBe(200);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 与机器人打完整局                                                     */
/* ------------------------------------------------------------------ */

describe('机器人整局', () => {
  it('连续多手全部由机器人打完：没有非法动作、没有翻牌前全下、账单为零', () => {
    const rng = createRng(20240607);
    let state = createTable({ seed: 20240607 });
    let preflopAllIns = 0;
    for (let hand = 0; hand < 25; hand += 1) {
      if (hand > 0) state = startHand(state);
      const total = totalChipsOnTable(state);
      let guard = 0;
      while (state.actor !== null) {
        const action = decideBotAction(state, state.actor, rng);
        if (action.type === 'allin') {
          if (state.street === 'preflop') preflopAllIns += 1;
        }
        state = applyAction(state, state.actor, action);
        guard += 1;
        expect(guard).toBeLessThan(400);
      }
      expect(totalChipsOnTable(state)).toBe(total);
      expect(state.result!.deltas.reduce((a, b) => a + b, 0)).toBe(0);
      expect(state.seats.every((seat: Seat) => seat.stack >= 0)).toBe(true);
    }
    expect(preflopAllIns).toBe(0);
  }, 30000);
});
