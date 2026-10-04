import { describe, expect, it } from 'vitest';

import { cards } from './helpers';
import { decideBotAction } from '../src/poker/ai';
import { describeHandValue } from '../src/poker/evaluator';
import { createRng } from '../src/poker/rng';
import {
  TABLE_CONSTANTS,
  applyAction,
  blindIndices,
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
  it('翻牌前只有「跟注 10」或「加注到 20」（大盲 10，20 封顶），没有全下', () => {
    const state = createTable({ seed: 1 });
    const legal = legalActions(state, 3);
    expect(legal.filter((action) => action.type === 'bet').map((action) => action.amount)).toEqual([
      20,
    ]);
    expect(legal.find((action) => action.type === 'bet')!.label).toBe('加注到 20');
    expect(actionTypes(state, 3)).not.toContain('allin');
    expect(legal[0].type).toBe('fold');
    expect(legal.some((action) => action.type === 'call' && action.amount === 10)).toBe(true);
  });

  it('下注 / 加注的档位就是本街投入，永远不超过 20', () => {
    // 翻牌后：0 → 5 → 10 → 20 都只是「本街投入」，一次也没有超过封顶。
    let state = createTable({ seed: 11 });
    while (state.street === 'preflop') {
      const seat = state.actor!;
      const legal = legalActions(state, seat);
      state = applyAction(
        state,
        seat,
        legal.find((a) => a.type === 'call') ?? legal.find((a) => a.type === 'check')!,
      );
    }
    const first = state.actor!;
    for (const [seat, level] of [
      [first, 5],
      [(first + 1) % 4, 10],
      [(first + 2) % 4, 20],
    ] as const) {
      const action = legalActions(state, seat).find((a) => a.type === 'bet' && a.amount === level);
      expect(action, `${seat} 应该能下注到 ${level}`).toBeDefined();
      state = applyAction(state, seat, action!);
      expect(state.seats[seat].committedStreet).toBe(level);
      expect(state.currentBet).toBe(level);
    }
    // 已经到 20 封顶，没人还能再加注。
    const capped = legalActions(state, state.actor!);
    expect(capped.some((action) => action.type === 'bet')).toBe(false);
    expect(capped.some((action) => action.type === 'allin')).toBe(true);
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

  it('翻牌前加到 20 就封顶，之后只能跟注或弃牌', () => {
    let state = createTable({ seed: 2 });
    expect(state.actor).toBe(3);
    state = applyAction(state, 3, { type: 'bet', amount: 20 });
    expect(state.raiseCount).toBe(1);
    expect(state.seats[3].committedStreet).toBe(20);
    const types = actionTypes(state, 0);
    expect(types).not.toContain('bet');
    expect(types).not.toContain('allin');
    expect(types).toContain('call');
    expect(types).toContain('fold');
  });

  it('加注到 20 只需要补「20 − 已经投入的部分」，跟注也不会超过封顶', () => {
    const state = createTable({ seed: 2 });
    // 3 号位是第一个说话的（大盲左手边），本街还没投入过。
    const raise = legalActions(state, 3).find((action) => action.type === 'bet')!;
    expect(raise.amount).toBe(20);
    const next = applyAction(state, 3, raise);
    expect(next.seats[3].committedStreet).toBe(20);
    expect(next.currentBet).toBe(20);
    expect(next.seats[3].stack).toBe(180);

    // 大盲已经投入 10，轮到它时加到 20 只需要再补 10。
    let blindState = createTable({ seed: 2 });
    blindState = applyAction(blindState, 3, { type: 'call' });
    blindState = applyAction(blindState, 0, { type: 'call' });
    blindState = applyAction(blindState, 1, { type: 'call' });
    expect(blindState.actor).toBe(2);
    expect(blindState.seats[2].committedStreet).toBe(10);
    const bbAction = legalActions(blindState, 2).find((action) => action.type === 'bet')!;
    expect(bbAction.amount).toBe(20);
    const afterBb = applyAction(blindState, 2, bbAction);
    expect(afterBb.seats[2].committedStreet).toBe(20);
    expect(afterBb.seats[2].stack).toBe(180);
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

/* ------------------------------------------------------------------ */
/* 非标准德州：下注额度固定、翻牌前禁止全下                              */
/* ------------------------------------------------------------------ */

describe('本桌不是标准无限注德州扑克', () => {
  it('扫完 40 手随机对局的每个决策点：下注/加注只能是 5 / 10 / 20，全下只出现在翻牌后', () => {
    const rng = createRng(4242);
    let state = createTable({ seed: 4242 });
    const betAmounts = new Set<number>();
    const labels = new Set<string>();
    const allinStreets = new Set<string>();
    const streetsWithBet = new Set<string>();
    const streetsWithAllIn = new Set<string>();
    let decisionPoints = 0;

    for (let hand = 0; hand < 40; hand += 1) {
      if (hand > 0) state = startHand(state);
      let guard = 0;
      while (state.actor !== null && guard < 400) {
        const seatIndex = state.actor;
        const seat = state.seats[seatIndex];
        const legal = legalActions(state, seatIndex);
        decisionPoints += 1;

        for (const action of legal) {
          labels.add(`${state.street} ${action.label}`);
          if (state.street === 'preflop') {
            // 翻牌前：既不能全下，也不允许「跟注即全下」。
            expect(action.type).not.toBe('allin');
            expect(action.label).not.toContain('全下');
          }
          if (action.type === 'bet') {
            betAmounts.add(action.amount!);
            streetsWithBet.add(state.street);
            // 档位 = 本街这一手你在自己面前的总投入，只有 5 / 10 / 20，20 封顶。
            expect([5, 10, 20]).toContain(action.amount);
            expect(action.amount).toBeLessThanOrEqual(20);
            expect(action.amount).toBeGreaterThan(state.currentBet);
            expect(action.label).toBe(
              `${state.currentBet > 0 ? '加注到' : '下注'} ${action.amount}`,
            );
            // 补的筹码 = 档位 − 已投入，补完之后正好落在档位上。
            const delta = action.amount! - seat.committedStreet;
            expect(delta).toBeGreaterThan(0);
            expect(seat.committedStreet + delta).toBe(action.amount);
          }
          if (action.type === 'allin') {
            allinStreets.add(state.street);
            streetsWithAllIn.add(state.street);
            expect(state.street === 'flop' || state.street === 'turn' || state.street === 'river').toBe(
              true,
            );
          }
        }

        // 机器人只能从合法动作里选，所以也顺带验证了「非法动作不可能发生」。
        const action = decideBotAction(state, seatIndex, rng);
        expect(findLegalAction(state, seatIndex, action)).toBeDefined();
        state = applyAction(state, seatIndex, action);
        guard += 1;
      }
    }

    expect(decisionPoints).toBeGreaterThan(200);
    // 三个档位都必须真的出现过，且不可能出现第四个（更不可能出现 25 或 30）。
    expect([...betAmounts].sort((a, b) => a - b)).toEqual([5, 10, 20]);
    // 下注 / 加注在四条街都有；全下只在翻牌之后出现。
    expect([...streetsWithBet].sort()).toEqual(['flop', 'preflop', 'river', 'turn']);
    expect([...allinStreets].sort()).toEqual(['flop', 'river', 'turn']);
    expect([...streetsWithAllIn]).not.toContain('preflop');
    // 按钮文案长这样（翻牌前）：弃牌 / 跟注 10 / 加注到 20…
    expect([...labels].some((label) => label === 'preflop 加注到 20')).toBe(true);
    expect([...labels].some((label) => label === 'preflop 跟注 10')).toBe(true);
    expect([...labels].every((label) => !label.startsWith('preflop 全下'))).toBe(true);
  }, 60000);
});

/* ------------------------------------------------------------------ */
/* 人数可调：加 / 减机器人                                              */
/* ------------------------------------------------------------------ */

describe('翻牌前禁止全下（只允许翻牌后 ALL IN）', () => {
  const STACKS = [1, 2, 5, 9, 10, 11, 15, 20, 21, 200];
  const COMMITTED = [0, 5, 10];
  const CURRENT_BETS = [10, 20];
  const RAISE_COUNTS = [0, 1, 2, 3];

  /** 把真实开局状态改造成各种刁钻局面（筹码被掏空、面对加注、加注次数用完…）。 */
  function hostileStates(street: 'preflop' | 'flop'): TableState[] {
    const out: TableState[] = [];
    for (let seatCount = 2; seatCount <= 6; seatCount += 1) {
      const base = startHand(createTable({ seed: seatCount * 31, seats: seatCount }));
      for (const stack of STACKS) {
        for (const own of COMMITTED) {
          for (const currentBet of CURRENT_BETS) {
            for (const raiseCount of RAISE_COUNTS) {
              for (let actor = 0; actor < seatCount; actor += 1) {
                const state = clone(base);
                state.street = street;
                state.board = street === 'flop' ? state.deck.slice(0, 3) : [];
                state.result = null;
                state.currentBet = currentBet;
                state.raiseCount = raiseCount;
                state.actor = actor;
                for (const seat of state.seats) {
                  seat.folded = false;
                  seat.allIn = false;
                  seat.hasActed = false;
                  seat.committedStreet = own;
                  seat.committedTotal = own;
                  seat.stack = stack;
                }
                out.push(state);
              }
            }
          }
        }
      }
    }
    return out;
  }

  it('扫遍 4800 个翻牌前局面：一个「全下」都没有，也不存在「跟注即全下」', () => {
    const states = hostileStates('preflop');
    expect(states.length).toBe(4800);
    for (const state of states) {
      const actor = state.actor!;
      const own = state.seats[actor].committedStreet;
      const stack = state.seats[actor].stack;
      const toCall = Math.max(0, state.currentBet - own);
      const legal = legalActions(state, actor);

      expect(legal.length).toBeGreaterThan(0);
      for (const action of legal) {
        expect(action.type, `翻牌前不该有 ${action.type}`).not.toBe('allin');
        expect(action.label).not.toContain('全下');
      }
      // 筹码不足以跟注时只剩弃牌（翻牌前不允许「跟注全下」）。
      if (stack <= toCall) {
        expect(legal.map((action) => action.type)).toEqual(['fold']);
      }
      // 手动硬塞全下：找不到，也执行不了。
      expect(findLegalAction(state, actor, { type: 'allin', amount: stack })).toBeNull();
      expect(() => applyAction(state, actor, { type: 'allin', amount: stack })).toThrow();
      // 翻牌前能拿到的加注档位一定付得起、而且一定留得下至少 1 个筹码。
      for (const action of legal.filter((candidate) => candidate.type === 'bet')) {
        const delta = action.amount! - own;
        expect(delta).toBeGreaterThan(0);
        expect(delta).toBeLessThan(stack);
      }
    }
  });

  it('同样的局面换成翻牌圈：能全下的时候全下按钮就出现', () => {
    for (const state of hostileStates('flop')) {
      const actor = state.actor!;
      const own = state.seats[actor].committedStreet;
      const stack = state.seats[actor].stack;
      const toCall = Math.max(0, state.currentBet - own);
      const legal = legalActions(state, actor);
      const allin = legal.find((action) => action.type === 'allin');

      if (stack > toCall) {
        expect(allin, `筹码 ${stack} / 需跟 ${toCall} 时应该有全下`).toBeDefined();
        expect(allin!.amount).toBe(stack);
        expect(allin!.label).toBe(`全下 ${stack}`);
        // 全下不受 20 封顶限制。
        expect(applyAction(state, actor, allin!).seats[actor].allIn).toBe(true);
      } else {
        expect(allin).toBeUndefined();
        // 跟不起的时候，跟注按钮本身就是「跟注 N（全下）」。
        expect(legal.some((action) => action.label.includes('全下'))).toBe(true);
      }
    }
  });
});

describe('人数可调', () => {
  it('座位数会被夹在 2 ～ 6 之间，名字依次是 你 / 机器人 A…E', () => {
    expect(createTable({ seed: 1, seats: 1 }).seats).toHaveLength(2);
    expect(createTable({ seed: 1, seats: 99 }).seats).toHaveLength(6);
    expect(createTable({ seed: 1, seats: 0 }).seats.map((seat) => seat.name)).toEqual([
      '你',
      '机器人 A',
    ]);
    expect(createTable({ seed: 1, seats: 6 }).seats.map((seat) => seat.name)).toEqual([
      '你',
      '机器人 A',
      '机器人 B',
      '机器人 C',
      '机器人 D',
      '机器人 E',
    ]);
    // 默认 4 人桌不变。
    expect(createTable({ seed: 1 }).seats).toHaveLength(TABLE_CONSTANTS.SEATS);
  });

  it('3 人以上：小盲在大盲在庄家左手边，且两个盲注座位永远不同', () => {
    for (let count = 3; count <= TABLE_CONSTANTS.MAX_SEATS; count += 1) {
      for (let button = 0; button < count; button += 1) {
        const { smallBlind, bigBlind } = blindIndices(count, button);
        expect(smallBlind).toBe((button + 1) % count);
        expect(bigBlind).toBe((button + 2) % count);
        expect(smallBlind).not.toBe(bigBlind);
      }
    }
  });

  it('两人单挑：庄家下小盲、翻牌前先行动，翻牌后由大盲先行动', () => {
    let state = createTable({ seed: 7, seats: 2 });
    expect(state.seats).toHaveLength(2);
    const first = blindIndices(2, state.button);
    // 单挑时庄家就是小盲，和三人以上不同。
    expect(first.smallBlind).toBe(state.button);
    expect(first.bigBlind).toBe((state.button + 1) % 2);
    expect(state.seats[first.smallBlind].committedStreet).toBe(TABLE_CONSTANTS.SMALL_BLIND);
    expect(state.seats[first.bigBlind].committedStreet).toBe(TABLE_CONSTANTS.BIG_BLIND);
    // 翻牌前：小盲（也就是庄家）先说话。
    expect(state.actor).toBe(first.smallBlind);

    state = applyAction(state, first.smallBlind, { type: 'call' });
    // 小盲补齐后，大盲保留一次选择权。
    expect(state.actor).toBe(first.bigBlind);
    state = applyAction(state, first.bigBlind, { type: 'check' });
    expect(state.street).toBe('flop');
    // 翻牌后：大盲（非庄家）先说话。
    expect(state.actor).toBe(first.bigBlind);

    // 第二手轮换庄家，两个盲注座位跟着换人。
    const second = startHand(state);
    expect(second.button).toBe((state.button + 1) % 2);
    const swap = blindIndices(2, second.button);
    expect(swap.smallBlind).toBe(second.button);
    expect(swap.smallBlind).not.toBe(first.smallBlind);
    expect(second.actor).toBe(swap.smallBlind);
  });

  it('2 ～ 6 人桌都由机器人打完几手：筹码守恒、无翻牌前全下、人数不变', () => {
    let postflopAllInsTotal = 0;
    let preflopAllInsTotal = 0;
    const streetsSeen = new Set<string>();
    for (let seats = 2; seats <= TABLE_CONSTANTS.MAX_SEATS; seats += 1) {
      const rng = createRng(1000 + seats);
      let state = createTable({ seed: 1000 + seats, seats });
      for (let hand = 0; hand < 6; hand += 1) {
        if (hand > 0) state = startHand(state);
        expect(state.seats).toHaveLength(seats);
        const total = totalChipsOnTable(state);
        let guard = 0;
        while (state.actor !== null) {
          const action = decideBotAction(state, state.actor, rng);
          expect(findLegalAction(state, state.actor, action)).toBeDefined();
          streetsSeen.add(state.street);
          if (action.type === 'allin') {
            if (state.street === 'preflop') preflopAllInsTotal += 1;
            else postflopAllInsTotal += 1;
          }
          state = applyAction(state, state.actor, action);
          guard += 1;
          expect(guard).toBeLessThan(600);
        }
        expect(totalChipsOnTable(state)).toBe(total);
        expect(state.result).not.toBeNull();
      }
    }
    // 翻牌前一次全下都没有；翻牌后确实会有人全下（覆盖到全下的分支）。
    expect(preflopAllInsTotal).toBe(0);
    expect(postflopAllInsTotal).toBeGreaterThan(0);
    expect([...streetsSeen].sort()).toEqual(['flop', 'preflop', 'river', 'turn']);
  }, 60000);
});
