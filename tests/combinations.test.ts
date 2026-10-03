import { describe, expect, it } from 'vitest';
import { cardKey, getRemainingDeck } from '../src/poker/cards';
import { enumerateOpponentHands } from '../src/poker/combinations';
import { getRankGroup } from '../src/poker/grouping';
import { cards, scenario } from './helpers';

describe('对手组合枚举', () => {
  const s = scenario('As Kd', 'Ah 8c 3d');
  const remaining = getRemainingDeck(s);
  const hands = enumerateOpponentHands(remaining);

  it('47 张牌产生 1081 个组合', () => {
    expect(remaining).toHaveLength(47);
    expect(hands).toHaveLength(1081);
    expect(hands).toHaveLength((47 * 46) / 2);
  });

  it('不存在重复组合（AB 与 BA 只算一次）', () => {
    const keys = hands.map(
      ([a, b]) => [cardKey(a), cardKey(b)].sort().join('-'),
    );
    expect(new Set(keys).size).toBe(1081);
  });

  it('单个组合内部不出现同一张牌两次', () => {
    for (const [a, b] of hands) {
      expect(cardKey(a)).not.toBe(cardKey(b));
    }
  });

  it('不包含任何已知牌（Blocker）', () => {
    const used = new Set(
      [...s.hero, ...s.flop].map(cardKey),
    );
    for (const hand of hands) {
      for (const card of hand) {
        expect(used.has(cardKey(card))).toBe(false);
      }
    }
  });
});

describe('点数类型聚合 getRankGroup', () => {
  it('忽略花色且高点数在前', () => {
    const [a, b] = cards('As 8d');
    expect(getRankGroup([a, b])).toBe('A8');
    const [c, d] = cards('8d As');
    expect(getRankGroup([c, d])).toBe('A8');
  });

  it('对子显示为 88', () => {
    const [a, b] = cards('8s 8h');
    expect(getRankGroup([a, b])).toBe('88');
  });

  it('KQ 顺序正确', () => {
    const [a, b] = cards('Kc Qd');
    expect(getRankGroup([a, b])).toBe('KQ');
  });
});
