/**
 * 发牌历史的快照栈。
 *
 * 发下一条街之前先压一份快照，收回时整份恢复，所以退回去看到的
 * 就是「发牌之前」的那一页（牌面、作答、结果都还在）。
 * 这里只放纯逻辑，方便单测；UI 侧另有 React 状态。
 */

import type { Scenario, Street } from '../poker/cards';
import { streetOf } from '../poker/cards';
import type { ScoreResult } from './scoring';
import type { TrainerAnswer, TrainerPhase } from './types';

export interface StreetSnapshot {
  scenario: Scenario;
  phase: TrainerPhase;
  answer: TrainerAnswer;
  score: ScoreResult | null;
}

/** 压入一份快照（返回新数组，不改原数组）。 */
export function pushStreetSnapshot(
  stack: StreetSnapshot[],
  snapshot: StreetSnapshot,
): StreetSnapshot[] {
  return [...stack, snapshot];
}

export interface PopStreetSnapshotResult {
  snapshot: StreetSnapshot;
  rest: StreetSnapshot[];
}

/** 弹出最近一份快照；已经退到最初的一手牌时返回 null。 */
export function popStreetSnapshot(
  stack: StreetSnapshot[],
): PopStreetSnapshotResult | null {
  const snapshot = stack[stack.length - 1];
  if (!snapshot) return null;
  return { snapshot, rest: stack.slice(0, -1) };
}

/** 还能不能往回退。 */
export function canUndoStreet(stack: StreetSnapshot[]): boolean {
  return stack.length > 0;
}

/** 退回去之后会落到哪一条街。 */
export function previousStreetOf(stack: StreetSnapshot[]): Street | null {
  const snapshot = stack[stack.length - 1];
  return snapshot ? streetOf(snapshot.scenario) : null;
}
