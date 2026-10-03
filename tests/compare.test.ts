import { describe, expect, it } from 'vitest';
import { evaluateFiveCards } from '../src/poker/evaluator';
import { compareHandValues } from '../src/poker/compare';
import { cards } from './helpers';

function value(input: string) {
  return evaluateFiveCards(cards(input));
}

describe('同牌型 Tie Break', () => {
  it('高牌：A K J 8 3 > A K T 9 8', () => {
    expect(compareHandValues(value('Ah Kd Jc 8s 3d'), value('Ah Kd Tc 9s 8d'))).toBe(1);
  });

  it('一对：KK > QQ', () => {
    expect(compareHandValues(value('Kh Kd Ac 8s 3d'), value('Qh Qd Ac 8s 3d'))).toBe(1);
  });

  it('一对：AAK83 > AAQ83', () => {
    expect(compareHandValues(value('Ah As Kd 8c 3d'), value('Ah As Qd 8c 3d'))).toBe(1);
  });

  it('一对：相同对子与踢脚时只有更小踢脚', () => {
    expect(compareHandValues(value('Ah As Kd Qc 3d'), value('Ah As Kd Jc 3d'))).toBe(1);
  });

  it('两对：AAKKQ > AAQQK', () => {
    expect(compareHandValues(value('Ah As Kd Kc Qd'), value('Ah As Qd Qc Kd'))).toBe(1);
  });

  it('两对：相同两对比较踢脚', () => {
    expect(compareHandValues(value('Ah As Kd Kc Qd'), value('Ah As Kd Kc Jd'))).toBe(1);
  });

  it('三条：先比较三条点数', () => {
    expect(compareHandValues(value('Ah As Ad Kc Qd'), value('Kh Ks Kd Ac Qd'))).toBe(1);
  });

  it('三条：相同三条比较踢脚', () => {
    expect(compareHandValues(value('Ah As Ad Kc Qd'), value('Ah As Ad Qc Jd'))).toBe(1);
  });

  it('顺子：比较最高牌', () => {
    expect(compareHandValues(value('9h 8s 7d 6c 5h'), value('8h 7s 6d 5c 4h'))).toBe(1);
  });

  it('同花：逐张比较', () => {
    expect(compareHandValues(value('Ah Kh 9h 6h 3h'), value('Ah Kh 8h 6h 3h'))).toBe(1);
  });

  it('葫芦：先比较三条部分，再比较对子', () => {
    expect(compareHandValues(value('Ah As Ad Kc Kd'), value('Kh Ks Kd Ac Ad'))).toBe(1);
    expect(compareHandValues(value('Ah As Ad Kc Kd'), value('Ah As Ad Qc Qd'))).toBe(1);
  });

  it('四条：先比较四条，再比较踢脚', () => {
    expect(compareHandValues(value('Ah As Ad Ac Kd'), value('Kh Ks Kd Kc Ad'))).toBe(1);
    expect(compareHandValues(value('Ah As Ad Ac Kd'), value('Ah As Ad Ac Qd'))).toBe(1);
  });

  it('同花顺：比较最高牌', () => {
    expect(compareHandValues(value('9s 8s 7s 6s 5s'), value('8s 7s 6s 5s 4s'))).toBe(1);
  });
});

describe('完全平手', () => {
  it('点数结构完全相同返回 0（忽略花色）', () => {
    expect(compareHandValues(value('Ah As Kd Kc Qd'), value('Ad Ac Kh Ks Qh'))).toBe(0);
  });

  it('高牌点数完全相同返回 0', () => {
    expect(compareHandValues(value('Ah Kd Qc 9s 7d'), value('As Kh Qd 9c 7s'))).toBe(0);
  });
});
