/** 随机出题。 */

import type { Card, Scenario } from './cards';
import { createDeck, getRemainingDeck, streetOf, validateScenario } from './cards';

export type ScenarioTag =
  | 'top-pair'
  | 'middle-pair'
  | 'overpair'
  | 'two-pair'
  | 'trips'
  | 'straight'
  | 'monotone'
  | 'two-tone'
  | 'paired-board'
  | 'connected-board'
  | 'dry-board';

export interface GenerateScenarioOptions {
  /** 第二版预留：按标签筛选题目。第一版忽略。 */
  tags?: ScenarioTag[];
  /** 可注入随机函数，便于测试复现。 */
  rng?: () => number;
}

function pickUnique(deck: Card[], count: number, rng: () => number): Card[] {
  const pool = [...deck];
  const picked: Card[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(rng() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}

/** 随机抽取 5 张唯一牌：2 张 Hero + 3 张 Flop。 */
export function generateRandomScenario(
  options: GenerateScenarioOptions = {},
): Scenario {
  const rng = options.rng ?? Math.random;
  const deck = createDeck();
  const picked = pickUnique(deck, 5, rng);
  const scenario: Scenario = {
    hero: [picked[0], picked[1]],
    flop: [picked[2], picked[3], picked[4]],
  };
  validateScenario(scenario);
  return scenario;
}

/**
 * 发下一张公共牌：翻牌 -> 转牌、转牌 -> 河牌，河牌之后原样返回。
 *
 * 新牌从「已知牌之外的全部剩余牌」中等概率抽一张，
 * 与前面的发牌完全一致（不偷看任何人的底牌）。
 */
export function dealNextStreet(
  scenario: Scenario,
  rng: () => number = Math.random,
): Scenario {
  const street = streetOf(scenario);
  if (street === 'river') return scenario;

  const remaining = getRemainingDeck(scenario);
  const card = remaining[Math.floor(rng() * remaining.length)];
  return street === 'flop' ? { ...scenario, turn: card } : { ...scenario, river: card };
}
