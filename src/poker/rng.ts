/**
 * 可复现的伪随机数发生器（mulberry32）。
 *
 * 牌桌的洗牌与机器人决策都走这里，因此同一个种子 + 同一串动作
 * 必然得到完全相同的一手牌，便于测试与复盘。
 * 种子本身是状态的一部分，所以整个牌桌状态是纯数据。
 */

export interface Rng {
  /** 当前种子（无符号 32 位整数）。 */
  seed: number;
}

export function normalizeSeed(seed: number): number {
  const value = Math.floor(seed) >>> 0;
  return value === 0 ? 0x9e3779b9 : value;
}

export function createRng(seed: number): Rng {
  return { seed: normalizeSeed(seed) };
}

/** 取下一个 [0, 1) 随机数，并推进种子。 */
export function nextRandom(rng: Rng): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = rng.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 取 [0, max) 的整数。 */
export function randomInt(rng: Rng, max: number): number {
  if (max <= 1) return 0;
  return Math.floor(nextRandom(rng) * max);
}

export function pickOne<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pickOne 需要非空数组');
  return items[randomInt(rng, items.length)];
}

/** Fisher-Yates 洗牌（原地，返回同一个数组）。 */
export function shuffleInPlace<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}
