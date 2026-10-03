import { describe, expect, it } from 'vitest';
import {
  cardToString,
  createDeck,
  getRemainingDeck,
  validateScenario,
} from '../src/poker/cards';
import {
  HandCategory,
  evaluateFiveCards,
} from '../src/poker/evaluator';
import { compareHandValues } from '../src/poker/compare';
import { cards, scenario } from './helpers';

describe('牌堆', () => {
  it('创建 52 张唯一扑克牌', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardToString)).size).toBe(52);
  });

  it('移除已知牌后剩余 47 张', () => {
    const s = scenario('As Kd', 'Ah 8c 3d');
    expect(getRemainingDeck(s)).toHaveLength(47);
  });

  it('拒绝重复牌的场景', () => {
    const s = scenario('As Kd', 'As 8c 3d');
    expect(() => validateScenario(s)).toThrow();
  });
});

describe('五张牌评价：牌型识别', () => {
  const cases: Array<[string, HandCategory]> = [
    ['Ah Kd Qc 9s 7d', HandCategory.HighCard],
    ['Ah As Kd Qc Jd', HandCategory.OnePair],
    ['Ah As Kd Kc Qd', HandCategory.TwoPair],
    ['Ah As Ad Kc Qd', HandCategory.Trips],
    ['9h 8s 7d 6c 5h', HandCategory.Straight],
    ['Ah Kh 9h 6h 3h', HandCategory.Flush],
    ['Ah As Ad Kc Kd', HandCategory.FullHouse],
    ['Ah As Ad Ac Kd', HandCategory.Quads],
    ['As Ks Qs Js Ts', HandCategory.StraightFlush],
  ];

  for (const [input, category] of cases) {
    it(`${input} -> ${HandCategory[category]}`, () => {
      expect(evaluateFiveCards(cards(input)).category).toBe(category);
    });
  }

  it('张数错误时抛出异常', () => {
    expect(() => evaluateFiveCards(cards('Ah Kd Qc 9s'))).toThrow();
    expect(() => evaluateFiveCards(cards('Ah Kd Qc 9s 7d 2c'))).toThrow();
  });
});

describe('牌型级别顺序', () => {
  const ordered = [
    'As Ks Qs Js Ts', // 同花顺
    'Ah As Ad Ac Kd', // 四条
    'Ah As Ad Kc Kd', // 葫芦
    'Ah Kh 9h 6h 3h', // 同花
    '9h 8s 7d 6c 5h', // 顺子
    'Ah As Ad Kc Qd', // 三条
    'Ah As Kd Kc Qd', // 两对
    'Ah As Kd Qc Jd', // 一对
    'Ah Kd Qc 9s 7d', // 高牌
  ];

  for (let i = 0; i < ordered.length - 1; i += 1) {
    it(`${ordered[i]} > ${ordered[i + 1]}`, () => {
      const high = evaluateFiveCards(cards(ordered[i]));
      const low = evaluateFiveCards(cards(ordered[i + 1]));
      expect(compareHandValues(high, low)).toBe(1);
      expect(compareHandValues(low, high)).toBe(-1);
    });
  }
});

describe('顺子特殊规则 A2345', () => {
  it('A2345 识别为 5 高顺子', () => {
    const wheel = evaluateFiveCards(cards('Ah 2s 3d 4c 5h'));
    expect(wheel.category).toBe(HandCategory.Straight);
    expect(wheel.tiebreak).toEqual([5]);
  });

  it('23456 > A2345', () => {
    const six = evaluateFiveCards(cards('2h 3s 4d 5c 6h'));
    const wheel = evaluateFiveCards(cards('Ah 2s 3d 4c 5h'));
    expect(compareHandValues(six, wheel)).toBe(1);
  });

  it('A2345 同花识别为 5 高同花顺', () => {
    const wheelFlush = evaluateFiveCards(cards('Ah 2h 3h 4h 5h'));
    expect(wheelFlush.category).toBe(HandCategory.StraightFlush);
    expect(wheelFlush.tiebreak).toEqual([5]);
  });
});
