import { parseCards } from '../src/poker/cards';
import type { Card, FlopScenario } from '../src/poker/cards';

/** 把 "Ah Kd Qc 9s 7d" 解析为 Card[]。 */
export function cards(input: string): Card[] {
  return parseCards(input);
}

export function tuple2(input: string): [Card, Card] {
  const parsed = parseCards(input);
  if (parsed.length !== 2) throw new Error(`需要 2 张牌：${input}`);
  return [parsed[0], parsed[1]];
}

export function tuple3(input: string): [Card, Card, Card] {
  const parsed = parseCards(input);
  if (parsed.length !== 3) throw new Error(`需要 3 张牌：${input}`);
  return [parsed[0], parsed[1], parsed[2]];
}

export function scenario(hero: string, flop: string): FlopScenario {
  return { hero: tuple2(hero), flop: tuple3(flop) };
}
