import { describe, expect, it } from 'vitest';

import { cards, tuple2 } from './helpers';
import {
  BOT_STYLES,
  botProfile,
  botStyle,
  decideBotAction,
  estimateEquity,
  preflopStrength,
  unknownCards,
} from '../src/poker/ai';
import { createRng } from '../src/poker/rng';
import {
  applyAction,
  createTable,
  legalActions,
  startHand,
  type TableState,
} from '../src/poker/table';

function clone(state: TableState): TableState {
  return {
    ...state,
    seats: state.seats.map((seat) => ({ ...seat })),
    board: [...state.board],
    deck: [...state.deck],
    log: [...state.log],
  };
}

/** 摆一个「河牌圈、轮到座位 1、面前有一个 20 的下注」的局面。 */
function facingBetState(hole: string, board: string): TableState {
  const next = clone(createTable({ seed: 3 }));
  next.board = cards(board);
  next.street = 'river';
  next.result = null;
  next.actor = 1;
  next.currentBet = 20;
  next.raiseCount = 1;
  next.seats.forEach((seat, index) => {
    seat.hole = null;
    seat.folded = index === 3;
    seat.allIn = false;
    seat.hasActed = index === 1 ? false : true;
    seat.committedStreet = index === 1 ? 0 : 20;
    seat.committedTotal = index === 1 ? 0 : 20;
    seat.stack = 200;
    seat.lastAction = null;
  });
  next.seats[1].hole = tuple2(hole);
  next.pot = next.seats.reduce((sum, seat) => sum + seat.committedTotal, 0);
  return next;
}

describe('起手牌强度', () => {
  it('大小关系符合直觉', () => {
    const score = (input: string) => preflopStrength(tuple2(input));
    expect(score('As Ah')).toBeGreaterThan(score('Ks Kh'));
    expect(score('Ks Kh')).toBeGreaterThan(score('2s 2h'));
    expect(score('As Ks')).toBeGreaterThan(score('As Kd'));
    expect(score('As Ks')).toBeGreaterThan(score('9s 8s'));
    expect(score('9s 8s')).toBeGreaterThan(score('7s 2d'));
    expect(score('7s 2d')).toBeGreaterThan(0);
    expect(score('As Ah')).toBeLessThanOrEqual(1);
  });

  it('数值落在一个合理的区间（对随机手牌的胜率附近）', () => {
    expect(preflopStrength(tuple2('As Ah'))).toBeCloseTo(1, 2);
    expect(preflopStrength(tuple2('7s 2d'))).toBeGreaterThan(0.3);
    expect(preflopStrength(tuple2('7s 2d'))).toBeLessThan(0.4);
    expect(preflopStrength(tuple2('As Ks'))).toBeGreaterThan(0.6);
    expect(preflopStrength(tuple2('As Ks'))).toBeLessThan(0.72);
  });
});

describe('胜率估计', () => {
  it('未知牌数量正确（对手组合数 = C(47,2)/C(46,2)/C(45,2)）', () => {
    const hole = tuple2('As Kd');
    expect(unknownCards(hole, cards('Qh 7s 2c'))).toHaveLength(47);
    expect(unknownCards(hole, cards('Qh 7s 2c 9d'))).toHaveLength(46);
    expect(unknownCards(hole, cards('Qh 7s 2c 9d 3h'))).toHaveLength(45);

    expect(estimateEquity(hole, cards('Qh 7s 2c'), 1).samples).toBe(1081);
    expect(estimateEquity(hole, cards('Qh 7s 2c 9d'), 1).samples).toBe(1035);
    expect(estimateEquity(hole, cards('Qh 7s 2c 9d 3h'), 1).samples).toBe(990);
  });

  it('坚果牌成牌强度是 1，垃圾牌接近 0', () => {
    const board = cards('Tc Td 6h 8s 2c');
    const nuts = estimateEquity(tuple2('Th Ts'), board, 1);
    expect(nuts.made).toBe(1);
    expect(nuts.equity).toBe(1);
    expect(nuts.draw).toBe(0);

    const trash = estimateEquity(tuple2('Ad 9d'), board, 1);
    expect(trash.made).toBeLessThan(0.5);
    expect(trash.made).toBeGreaterThan(0);
  });

  it('对手越多胜率越低，翻牌圈听牌会给出正数补成概率', () => {
    const board = cards('Qh 7s 2c');
    const one = estimateEquity(tuple2('As Kd'), board, 1);
    const three = estimateEquity(tuple2('As Kd'), board, 3);
    expect(three.equity).toBeLessThan(one.equity);

    const flushDraw = estimateEquity(tuple2('9h 8h'), cards('Ah 2h 5c'), 1);
    expect(flushDraw.draw).toBeGreaterThan(0);
    expect(flushDraw.equity).toBeGreaterThan(flushDraw.made);
  });
});

describe('机器人决策', () => {
  it('同一颗种子给出同一串动作（可复现）', () => {
    const state = createTable({ seed: 77 });
    const a = decideBotAction(state, state.actor!, createRng(9));
    const b = decideBotAction(state, state.actor!, createRng(9));
    expect(a).toEqual(b);
  });

  it('坚果牌面对下注不会弃牌，垃圾牌会弃牌', () => {
    const nuts = facingBetState('Th Ts', 'Tc Td 6h 8s 2c');
    const decision = decideBotAction(nuts, 1, createRng(4));
    expect(decision.type).not.toBe('fold');
    expect(
      legalActions(nuts, 1).some(
        (action) =>
          action.type === decision.type &&
          (decision.amount === undefined || action.amount === decision.amount),
      ),
    ).toBe(true);

    const trash = facingBetState('Ad 9d', 'Tc Td 6h 8s 2c');
    expect(decideBotAction(trash, 1, createRng(4)).type).toBe('fold');
  });

  it('每条街都给出合法动作，且翻牌前从不全下', () => {
    const rng = createRng(31337);
    let state = createTable({ seed: 31337 });
    let decisions = 0;
    for (let hand = 0; hand < 12; hand += 1) {
      if (hand > 0) state = startHand(state);
      let guard = 0;
      while (state.actor !== null) {
        const seat = state.actor;
        const action = decideBotAction(state, seat, rng);
        const legal = legalActions(state, seat);
        expect(legal.length).toBeGreaterThan(0);
        const match = legal.find(
          (candidate) =>
            candidate.type === action.type &&
            (action.amount === undefined || candidate.amount === action.amount),
        );
        expect(match, `非法动作 ${JSON.stringify(action)}`).toBeDefined();
        if (state.street === 'preflop') expect(action.type).not.toBe('allin');
        state = applyAction(state, seat, action);
        decisions += 1;
        guard += 1;
        expect(guard).toBeLessThan(400);
      }
      expect(state.result).not.toBeNull();
    }
    expect(decisions).toBeGreaterThan(20);
  }, 20000);

  it('每个座位有自己的风格说明', () => {
    expect(BOT_STYLES.length).toBeGreaterThanOrEqual(3);
    for (let seat = 0; seat < 4; seat += 1) {
      expect(botStyle(seat).label.length).toBeGreaterThan(0);
      expect(botProfile(seat)).toContain('%');
    }
  });
});
