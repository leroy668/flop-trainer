/** 随机出题。 */

import type { Card, FlopScenario } from './cards';
import { createDeck, validateScenario } from './cards';

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
export function generateRandomFlopScenario(
  options: GenerateScenarioOptions = {},
): FlopScenario {
  const rng = options.rng ?? Math.random;
  const deck = createDeck();
  const picked = pickUnique(deck, 5, rng);
  const scenario: FlopScenario = {
    hero: [picked[0], picked[1]],
    flop: [picked[2], picked[3], picked[4]],
  };
  validateScenario(scenario);
  return scenario;
}
