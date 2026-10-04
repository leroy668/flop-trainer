import { describe, expect, it } from 'vitest';
import { analyzeScenario } from '../src/poker/analyzer';
import type { Card, Scenario } from '../src/poker/cards';
import {
  boardCards,
  createDeck,
  getRemainingDeck,
  knownCards,
  remainingBoardCards,
  streetOf,
  validateScenario,
} from '../src/poker/cards';
import { compareHandValues } from '../src/poker/compare';
import { analyzeDraws, analyzeHeroDraws } from '../src/poker/draws';
import {
  describeHandValue,
  evaluateBestHand,
  evaluateFiveCards,
} from '../src/poker/evaluator';
import { dealNextStreet, generateRandomScenario } from '../src/poker/randomScenario';
import { cards, scenario, tuple2, tuple3 } from './helpers';

/** 用 "hero | board" 形式构造任意街的场景。 */
function street(hero: string, board: string): Scenario {
  const [h1, h2] = tuple2(hero);
  const b = cards(board);
  return {
    hero: [h1, h2],
    flop: tuple3(board.split(' ').slice(0, 3).join(' ')),
    ...(b[3] ? { turn: b[3] } : {}),
    ...(b[4] ? { river: b[4] } : {}),
  };
}

const FLOP = scenario('As Kd', 'Ah 8c 3d');
const TURN = street('As Kd', 'Ah 8c 3d 2s');
const RIVER = street('As Kd', 'Ah 8c 3d 2s 9h');

describe('街道识别与牌面工具', () => {
  it('streetOf 按公共牌数量判断街', () => {
    expect(streetOf(FLOP)).toBe('flop');
    expect(streetOf(TURN)).toBe('turn');
    expect(streetOf(RIVER)).toBe('river');
  });

  it('boardCards 依次返回已发的公共牌', () => {
    expect(boardCards(FLOP)).toHaveLength(3);
    expect(boardCards(TURN)).toHaveLength(4);
    expect(boardCards(RIVER)).toHaveLength(5);
  });

  it('knownCards = 手牌 + 公共牌', () => {
    expect(knownCards(FLOP)).toHaveLength(5);
    expect(knownCards(TURN)).toHaveLength(6);
    expect(knownCards(RIVER)).toHaveLength(7);
  });

  it('remainingBoardCards 是还没发的公共牌张数', () => {
    expect(remainingBoardCards(FLOP)).toBe(2);
    expect(remainingBoardCards(TURN)).toBe(1);
    expect(remainingBoardCards(RIVER)).toBe(0);
  });

  it('未知牌从 52 张里按已知牌扣减：47 / 46 / 45', () => {
    expect(getRemainingDeck(FLOP)).toHaveLength(47);
    expect(getRemainingDeck(TURN)).toHaveLength(46);
    expect(getRemainingDeck(RIVER)).toHaveLength(45);
  });

  it('转牌 / 河牌不能与已知牌重复', () => {
    expect(() => validateScenario(FLOP)).not.toThrow();
    expect(() => validateScenario(TURN)).not.toThrow();
    expect(() => validateScenario(RIVER)).not.toThrow();
    // 河牌与转牌重复
    expect(() => validateScenario(street('As Kd', 'Ah 8c 3d 2s 2s'))).toThrow();
    // 河牌与手牌重复
    expect(() => validateScenario(street('As Kd', 'Ah 8c 3d 2s As'))).toThrow();
    // 转牌与手牌重复
    expect(() => validateScenario(street('As Kd', 'Ah 8c 3d Kd'))).toThrow();
  });
});

/** 朴素暴力：枚举全部 C(n,5) 子集取最大。 */
function bruteBest(cardsIn: readonly Card[]) {
  let best = evaluateFiveCards(cardsIn.slice(0, 5));
  const picked: number[] = [];
  const walk = (start: number) => {
    if (picked.length === 5) {
      const value = evaluateFiveCards(picked.map((i) => cardsIn[i]));
      if (compareHandValues(value, best) > 0) best = value;
      return;
    }
    for (let i = start; i < cardsIn.length; i += 1) {
      picked.push(i);
      walk(i + 1);
      picked.pop();
    }
  };
  walk(0);
  return best;
}

describe('六 / 七 张取最优五张', () => {
  it('6 张牌取最大组合', () => {
    // A2345 顺子 > 一对
    expect(describeHandValue(evaluateBestHand(cards('As Kd 2c 3d 4h 5s')))).toContain(
      '顺子',
    );
  });

  it('7 张牌能选出葫芦', () => {
    expect(describeHandValue(evaluateBestHand(cards('As Ad Ah Kc Kd Ks 2h')))).toContain(
      '葫芦',
    );
  });

  it('7 张牌能选出同花顺', () => {
    expect(describeHandValue(evaluateBestHand(cards('9h 8h 7h 6h 5h Kd 2c')))).toContain(
      '同花顺',
    );
  });

  it('7 张牌不会漏掉「用两张手牌凑出的同花」', () => {
    // As Ks + Qs Js 2s 4d 9c：五张黑桃同花 A K Q J 2
    const value = evaluateBestHand(cards('As Ks Qs Js 2s 4d 9c'));
    expect(describeHandValue(value)).toContain('同花');
    expect(value.tiebreak[0]).toBe(14);
  });

  it('5 张牌时与 evaluateFiveCards 等价', () => {
    const five = cards('Ah Kh Qh Jh 9h');
    expect(evaluateBestHand(five)).toEqual(evaluateFiveCards(five));
  });

  it('与暴力枚举 C(n,5) 完全一致（随机 6 / 7 张各 60 轮）', () => {
    const deck = createDeck();
    for (const size of [6, 7]) {
      for (let round = 0; round < 60; round += 1) {
        const pool = [...deck];
        for (let i = 0; i < size; i += 1) {
          const j = i + Math.floor(Math.random() * (pool.length - i));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const hand = pool.slice(0, size);
        expect(evaluateBestHand(hand)).toEqual(bruteBest(hand));
      }
    }
  });
});

describe('转牌 / 河牌圈的组合总数', () => {
  it('翻牌 1081 / 转牌 1035 / 河牌 990', () => {
    expect(analyzeScenario(FLOP).totalOpponentCombos).toBe(1081);
    expect(analyzeScenario(TURN).totalOpponentCombos).toBe(1035);
    expect(analyzeScenario(RIVER).totalOpponentCombos).toBe(990);
  });

  it('领先 + 平手 + 落后 = 总数', () => {
    for (const s of [FLOP, TURN, RIVER]) {
      const a = analyzeScenario(s);
      expect(a.aheadCount + a.tieCount + a.behindCount).toBe(a.totalOpponentCombos);
      expect(a.results).toHaveLength(a.totalOpponentCombos);
    }
  });

  it('每个牌型的组合数之和 = 总数', () => {
    for (const s of [FLOP, TURN, RIVER]) {
      const a = analyzeScenario(s);
      const sum = a.byCategory.reduce((acc, item) => acc + item.totalCount, 0);
      expect(sum).toBe(a.totalOpponentCombos);
    }
  });

  it('概率分母跟着街变化', () => {
    const turn = analyzeScenario(TURN);
    expect(turn.aheadProbability).toBeCloseTo(turn.aheadCount / 1035, 12);
    const river = analyzeScenario(RIVER);
    expect(river.behindProbability).toBeCloseTo(river.behindCount / 990, 12);
  });
});

describe('固定场景的转牌 / 河牌结果', () => {
  it('转牌 2s 后：领先 71 / 平手 6 / 落后 958', () => {
    const a = analyzeScenario(TURN);
    expect(a.street).toBe('turn');
    expect(a.remainingCount).toBe(46);
    expect([a.aheadCount, a.tieCount, a.behindCount]).toEqual([71, 6, 958]);
    expect(describeHandValue(a.heroHandValue)).toBe('一对 A');
  });

  it('河牌 9h 后：领先 107 / 平手 6 / 落后 877', () => {
    const a = analyzeScenario(RIVER);
    expect(a.street).toBe('river');
    expect(a.remainingCount).toBe(45);
    expect([a.aheadCount, a.tieCount, a.behindCount]).toEqual([107, 6, 877]);
    // 河牌 9h 让 Hero 依然是一对 A
    expect(describeHandValue(a.heroHandValue)).toBe('一对 A');
  });

  it('转牌让 Hero 成两对时，能压过他的组合骤减到 8 个', () => {
    const a = analyzeScenario(street('As Kd', 'Ah 8c 3d Ks'));
    expect(describeHandValue(a.heroHandValue)).toBe('两对 A、K');
    expect(a.aheadCount).toBe(8);
  });

  it('河牌成葫芦后只有 44 个组合能压过', () => {
    const a = analyzeScenario(street('As Ad', 'Ah Kc Kd Ks 2h'));
    expect(describeHandValue(a.heroHandValue)).toBe('葫芦（三条A + 一对K）');
    expect(a.aheadCount).toBe(44);
    expect(a.tieCount).toBe(0);
  });
});

describe('转牌 / 河牌圈的听牌', () => {
  it('转牌圈只剩一张河牌：next 与 final 使用同一批牌', () => {
    const d = analyzeDraws(street('As Ks', 'Qs 7s 2h 3d'));
    expect(d.hero.remainingBoardCards).toBe(1);
    expect(d.hero.finished).toBe(false);
    expect(d.hero.nextTotal).toBe(46);
    expect(d.hero.finalTotal).toBe(46);
    expect(d.hero.rows).toHaveLength(1);
    const row = d.hero.rows[0];
    expect(row.label).toBe('同花听牌 ♠');
    expect(row.completion.nextCount).toBe(9);
    expect(row.completion.finalCount).toBe(9);
    expect(row.completion.finalProbability).toBeCloseTo(9 / 46, 12);
  });

  it('转牌圈对手总量：44 张未知牌，44 个等权后续', () => {
    const d = analyzeDraws(street('As Ks', 'Qs 7s 2h 3d'));
    expect(d.opponent.totalCombos).toBe(1035);
    expect(d.opponent.nextTotal).toBe(44);
    expect(d.opponent.finalTotal).toBe(44);
    expect(
      d.opponent.immediateCombos +
        d.opponent.backdoorOnlyCombos +
        d.opponent.noDrawCombos,
    ).toBe(1035);
  });

  it('转牌圈不可能出现后门听牌', () => {
    for (let i = 0; i < 30; i += 1) {
      const turn = dealNextStreet(generateRandomScenario());
      const d = analyzeDraws(turn);
      expect(d.hero.rows.every((row) => !row.backdoor)).toBe(true);
      expect(d.opponent.backdoorOnlyCombos).toBe(0);
      expect(d.opponent.backdoorRow).toBeNull();
    }
  });

  it('河牌圈没有听牌可言', () => {
    const d = analyzeDraws(RIVER);
    expect(d.hero.finished).toBe(true);
    expect(d.hero.rows).toHaveLength(0);
    // 直接调 analyzeHeroDraws 也不能报出听牌（河牌之后没有牌可发）。
    const heroOnly = analyzeHeroDraws(RIVER);
    expect(heroOnly.rows).toEqual([]);
    expect(heroOnly.union.finalCount).toBe(0);
    expect(heroOnly.union.nextCount).toBe(0);
    expect(d.opponent.finished).toBe(true);
    expect(d.opponent.totalCombos).toBe(990);
    expect(d.opponent.noDrawCombos).toBe(990);
    expect(d.opponent.drawingCombos).toBe(0);
    expect(d.opponent.completeProbability).toBe(0);
  });

  it('翻牌圈的经典数字没被破坏', () => {
    const flushDraw = analyzeDraws(scenario('As Ks', 'Qs 7s 2h'));
    const flush = flushDraw.hero.rows.find((row) => row.label === '同花听牌 ♠')!;
    expect(flush.completion.finalCount).toBe(378);
    expect(flushDraw.hero.finalTotal).toBe(1081);
    expect(flushDraw.opponent.finalTotal).toBe(990);

    const openEnded = analyzeDraws(scenario('9s 8d', '6c 7h Kd'));
    expect(openEnded.hero.union.finalCount).toBe(340);

    const gutshot = analyzeDraws(scenario('9s 8d', '5c 6h Kd'));
    expect(gutshot.hero.union.finalCount).toBe(178);
  });
});

describe('发下一条街', () => {
  it('翻牌 -> 转牌 -> 河牌 -> 河牌（幂等）', () => {
    const flop = generateRandomScenario();
    const turn = dealNextStreet(flop);
    expect(streetOf(turn)).toBe('turn');
    expect(turn.flop).toEqual(flop.flop);
    expect(turn.hero).toEqual(flop.hero);

    const river = dealNextStreet(turn);
    expect(streetOf(river)).toBe('river');
    expect(river.turn).toEqual(turn.turn);
    expect(river.hero).toEqual(turn.hero);
    expect(river.flop).toEqual(turn.flop);

    expect(dealNextStreet(river)).toEqual(river);
  });

  it('新牌一定是此前未知的牌', () => {
    for (let i = 0; i < 50; i += 1) {
      const flop = generateRandomScenario();
      const turn = dealNextStreet(flop);
      const known = new Set(knownCards(flop).map((card) => `${card.rank}${card.suit}`));
      expect(known.has(`${turn.turn!.rank}${turn.turn!.suit}`)).toBe(false);

      const river = dealNextStreet(turn);
      const known2 = new Set(knownCards(turn).map((card) => `${card.rank}${card.suit}`));
      expect(known2.has(`${river.river!.rank}${river.river!.suit}`)).toBe(false);
      expect(() => validateScenario(river)).not.toThrow();
    }
  });

  it('确定性随机源可以复现发牌', () => {
    const makeRng = () => {
      const seq = [0.1, 0.9, 0.42, 0.77];
      let i = 0;
      return () => seq[i++ % seq.length];
    };
    const a = dealNextStreet(scenario('As Kd', 'Ah 8c 3d'), makeRng());
    const b = dealNextStreet(scenario('As Kd', 'Ah 8c 3d'), makeRng());
    expect(a.turn).toEqual(b.turn);
  });
});
