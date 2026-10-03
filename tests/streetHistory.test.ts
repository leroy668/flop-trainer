import { describe, expect, it } from 'vitest';
import { dealNextStreet } from '../src/poker/randomScenario';
import type { Scenario } from '../src/poker/cards';
import { streetOf } from '../src/poker/cards';
import {
  canUndoStreet,
  popStreetSnapshot,
  previousStreetOf,
  pushStreetSnapshot,
} from '../src/trainer/streetHistory';
import type { StreetSnapshot } from '../src/trainer/streetHistory';
import type { ScoreResult } from '../src/trainer/scoring';
import { scenario } from './helpers';

/** 用一个固定随机源发牌：永远取剩余牌堆的第一张，结果可复现。 */
function deal(current: Scenario): Scenario {
  return dealNextStreet(current, () => 0);
}

const ANSWER = {
  selectedCategories: [2, 3],
  categoryProbabilityAnswers: { 2: '0-1' },
  sameCategoryAheadRangeId: '1-3',
};

const SCORE: ScoreResult = {
  actualCategories: [2],
  selectedCategories: [2, 3],
  missedCategories: [],
  extraCategories: [3],
  categoryPerfect: false,
  categoryRangeScores: [],
  categoryRangeCorrect: 1,
  categoryRangeTotal: 2,
  sameCategoryCorrect: true,
  sameCategoryTotal: 1,
};

function snapshot(
  scenario_: Scenario,
  overrides: Partial<StreetSnapshot> = {},
): StreetSnapshot {
  return {
    scenario: scenario_,
    phase: 'result',
    answer: ANSWER,
    score: SCORE,
    ...overrides,
  };
}

describe('发牌快照栈（收回上一街）', () => {
  it('空栈不能收回', () => {
    expect(canUndoStreet([])).toBe(false);
    expect(popStreetSnapshot([])).toBeNull();
    expect(previousStreetOf([])).toBeNull();
  });

  it('push / pop 是 LIFO，且不改动原数组', () => {
    const flop = scenario('As Kd', 'Ah 8c 3d');
    const turn = deal(flop);
    const stack = pushStreetSnapshot(
      pushStreetSnapshot([], snapshot(flop)),
      snapshot(turn),
    );
    expect(stack).toHaveLength(2);
    expect(stack[1].scenario).toBe(turn);

    const popped = popStreetSnapshot(stack);
    expect(popped?.snapshot.scenario).toBe(turn);
    expect(popped?.rest).toHaveLength(1);
    expect(stack).toHaveLength(2); // 原数组没被动过
    expect(canUndoStreet(popped!.rest)).toBe(true);
  });

  it('翻牌 -> 转牌 -> 河牌 可以连退两次，每次都回到发牌之前', () => {
    const flop = scenario('As Kd', 'Ah 8c 3d');
    const turn = deal(flop);
    const river = deal(turn);
    expect(streetOf(flop)).toBe('flop');
    expect(streetOf(turn)).toBe('turn');
    expect(streetOf(river)).toBe('river');

    // 站在河牌圈时，栈里是「发转牌前」与「发河牌前」两份快照
    const stack = pushStreetSnapshot(
      pushStreetSnapshot([], snapshot(flop)),
      snapshot(turn),
    );

    // 第一退：河牌 -> 转牌圈，river 要重新变回「还没发」
    const first = popStreetSnapshot(stack);
    expect(first?.snapshot.scenario).toBe(turn);
    expect(first?.snapshot.scenario.turn).toBe(turn.turn);
    expect(first?.snapshot.scenario.river).toBeUndefined();
    expect(previousStreetOf(first!.rest)).toBe('flop');

    // 第二退：转牌 -> 翻牌圈，turn / river 都要变回「还没发」
    const second = popStreetSnapshot(first!.rest);
    expect(second?.snapshot.scenario).toBe(flop);
    expect(second?.snapshot.scenario.turn).toBeUndefined();
    expect(second?.snapshot.scenario.river).toBeUndefined();
    expect(second?.rest).toHaveLength(0);
    expect(canUndoStreet(second!.rest)).toBe(false);
    expect(previousStreetOf(second!.rest)).toBeNull();
  });

  it('恢复的是同一份作答与结果（不是重开一题）', () => {
    const flop = scenario('As Kd', 'Ah 8c 3d');
    const popped = popStreetSnapshot(
      pushStreetSnapshot([], snapshot(flop, { phase: 'result' })),
    );
    expect(popped?.snapshot.answer).toBe(ANSWER); // 同一个对象引用
    expect(popped?.snapshot.score).toBe(SCORE);
    expect(popped?.snapshot.phase).toBe('result');
    expect(streetOf(popped!.snapshot.scenario)).toBe('flop');
  });

  it('可以保存「发牌时还没作答」的状态（作答页收回也一样）', () => {
    const turn = deal(scenario('As Kd', 'Ah 8c 3d'));
    const fresh = {
      selectedCategories: [],
      categoryProbabilityAnswers: {},
    };
    const popped = popStreetSnapshot(
      pushStreetSnapshot(
        [],
        snapshot(turn, { phase: 'answer-categories', answer: fresh, score: null }),
      ),
    );
    expect(popped?.snapshot.phase).toBe('answer-categories');
    expect(popped?.snapshot.answer.selectedCategories).toEqual([]);
    expect(popped?.snapshot.score).toBeNull();
    expect(streetOf(popped!.snapshot.scenario)).toBe('turn');
  });

  it('previousStreetOf 返回栈顶快照所在的街道，也就是退回去之后所在的街', () => {
    const flop = scenario('As Kd', 'Ah 8c 3d');
    const turn = deal(flop);
    const river = deal(turn);
    expect(previousStreetOf([snapshot(flop)])).toBe('flop');
    expect(previousStreetOf([snapshot(flop), snapshot(turn)])).toBe('turn');
    expect(previousStreetOf([snapshot(flop), snapshot(turn), snapshot(river)])).toBe(
      'river',
    );
  });
});
