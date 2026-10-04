import { describe, expect, it } from 'vitest';
import type { Scenario } from '../src/poker/cards';
import { cardKey, parseCards } from '../src/poker/cards';
import { analyzeHeroDraws } from '../src/poker/draws';
import { HandCategory } from '../src/poker/evaluator';
import { summarizeFiveCardHand } from '../src/poker/handType';
import type { FiveCardSummary } from '../src/poker/handType';
import { analyzeHeroOutlook } from '../src/poker/outlook';

/** "As Kd" + "Ah 8c 3d" 这样的写法构造场景，公共牌 3~5 张。 */
function make(hero: string, board: string): Scenario {
  const cards = parseCards(`${hero} ${board}`);
  return {
    hero: [cards[0], cards[1]],
    flop: [cards[2], cards[3], cards[4]],
    turn: cards[5],
    river: cards[6],
  };
}

function summarize(hero: string, board: string): FiveCardSummary {
  const scenario = make(hero, board);
  return summarizeFiveCardHand(scenario, analyzeHeroDraws(scenario));
}

describe('当前 5 张牌的归类', () => {
  it('口袋对大过公共牌 -> 超对', () => {
    const summary = summarize('Kh Kd', 'Qh 7s 3d');
    expect(summary.madeHand).toBe('超对');
    expect(summary.pairPosition).toBe('overpair');
    expect(summary.kind).toBe('made');
    expect(summary.isAir).toBe(false);
    expect(summary.draws).toEqual([]);
    expect(summary.summary).toBe('超对');
    expect(summary.overcards).toBe(2);
  });

  it('口袋对小于公共牌 -> 小对子', () => {
    const summary = summarize('8h 8d', 'Ah Kc 2s');
    expect(summary.madeHand).toBe('小对子');
    expect(summary.pairPosition).toBe('underpair');
    expect(summary.overcards).toBe(0);
  });

  it('配中公共牌最大牌 -> 顶对', () => {
    const summary = summarize('As Kd', 'Ah 8c 3d');
    expect(summary.madeHand).toBe('顶对');
    expect(summary.detail).toContain('A');
    expect(summary.summary).toBe('顶对');
  });

  it('配中中间牌 / 最小牌 -> 中对 / 底对', () => {
    expect(summarize('8h Kd', 'Ah 8c 3d').madeHand).toBe('中对');
    expect(summarize('3h Kd', 'Ah 8c 3d').madeHand).toBe('底对');
  });

  it('公共牌成对、底牌都没配中 -> 公共牌对', () => {
    const summary = summarize('Ah Kd', 'Qc Qd 3s');
    expect(summary.category).toBe(HandCategory.OnePair);
    expect(summary.madeHand).toBe('公共牌对');
    expect(summary.detail).toContain('公共牌 QQ 成对');
  });

  it('高牌区分几张高张', () => {
    const two = summarize('Ah Kd', 'Qc 7s 3d');
    expect(two.isAir).toBe(true);
    expect(two.detail).toBe('A 高，两张高张');
    expect(two.overcards).toBe(2);

    const one = summarize('Ah 2d', 'Kc 7s 3d');
    expect(one.detail).toBe('A 高，一张高张');

    const none = summarize('2h 7d', 'Kc 9s Ad');
    expect(none.detail).toBe('A 高，两张都是小牌');
    expect(none.summary).toBe('空气（没有成牌，也没有听牌）');
  });

  it('三条区分暗三条与明三条', () => {
    const set = summarize('8h 8d', 'Ah 8c 2s');
    expect(set.madeHand).toBe('三条');
    expect(set.detail).toBe('暗三条：口袋 88 配中公共牌');

    const trips = summarize('Ah Kd', 'Ac Ad 2s');
    expect(trips.madeHand).toBe('三条');
    expect(trips.detail).toBe('明三条：底牌 A 配中公共牌的对子');
  });

  it('公共牌自己就是三条时，不能说成明三条', () => {
    const summary = summarize('2h 8d', '6h 6s 6d');
    expect(summary.madeHand).toBe('三条');
    expect(summary.detail).toBe(
      '公共牌三条：公共牌自己就有 666，底牌只提供踢脚',
    );
    expect(summary.overcards).toBe(1);
  });

  it('两对及以上直接用评价器的描述', () => {
    const twoPair = summarize('As 8d', 'Ah 8c 3d');
    expect(twoPair.madeHand).toBe('两对');
    expect(twoPair.detail).toBe('两对 A、8');

    const flush = summarize('As Ks', 'Qs 7s 2s');
    expect(flush.madeHand).toBe('同花');
    expect(flush.kind).toBe('strong');
  });

  it('叠上听牌后归类名是「已成牌 + 听牌」', () => {
    const summary = summarize('Ah Kh', 'Qh Jh 2s');
    expect(summary.madeHand).toBe('高牌');
    expect(summary.isAir).toBe(true);
    expect(summary.draws.map((draw) => draw.label)).toEqual([
      '同花听牌 ♥',
      '顺子听牌（卡顺）',
    ]);
    expect(summary.comboDraw).toBe(true);
    expect(summary.kind).toBe('draw');
    expect(summary.summary).toBe('高牌 + 同花听牌 ♥ + 顺子听牌（卡顺）');
    // 同花听牌 9 张补牌，卡顺 4 张。
    expect(summary.draws[0].outs).toBe(9);
    expect(summary.draws[0].nextProbability).toBeCloseTo(9 / 47, 12);
    expect(summary.draws[1].outs).toBe(4);
  });

  it('顶对 + 同花听牌：一定要把两边都说清楚', () => {
    const summary = summarize('Ks Qs', 'Qh 7s 2s');
    expect(summary.madeHand).toBe('顶对');
    expect(summary.draws.map((draw) => draw.label)).toEqual(['同花听牌 ♠']);
    expect(summary.comboDraw).toBe(false);
    expect(summary.summary).toBe('顶对 + 同花听牌 ♠');
  });

  it('后门听牌也算进归类，但补牌数记为 0', () => {
    const summary = summarize('As Ks', 'Qh 7s 2h');
    const backdoor = summary.draws.find((draw) => draw.backdoor);
    expect(backdoor?.label).toBe('后门同花听牌 ♠');
    expect(backdoor?.outs).toBe(0);
    expect(summary.summary).toContain('后门同花听牌 ♠');
  });

  it('转牌 / 河牌同样可以归类', () => {
    expect(summarize('Ah Kd', 'Ac 8h 3s 2d').madeHand).toBe('顶对');
    expect(summarize('Ah Kd', 'Ac 8h 3s 2d 7c').madeHand).toBe('顶对');
    const river = summarize('As Ad', 'Ah Kc Kd Ks 2h');
    expect(river.madeHand).toBe('葫芦');
    expect(river.summary).toBe('葫芦');
    // 河牌已经发完，不能再报出听牌。
    expect(river.draws).toEqual([]);
    expect(river.comboDraw).toBe(false);
    const riverDraw = summarize('As Kd', 'Ah 8c 3d 2s 9h');
    expect(riverDraw.madeHand).toBe('顶对');
    expect(riverDraw.summary).toBe('顶对');
  });
});

describe('发完后最终牌型的分布', () => {
  it('翻牌圈枚举 1081 个后续，且只有变强与保持', () => {
    const outlook = analyzeHeroOutlook(make('As Kd', 'Ah 8c 3d'));
    expect(outlook.total).toBe(1081);
    expect(outlook.remainingBoardCards).toBe(2);
    expect(outlook.currentCategory).toBe(HandCategory.OnePair);
    expect(outlook.rows.reduce((sum, row) => sum + row.count, 0)).toBe(1081);
    expect(outlook.worsenCount).toBe(0);
    expect(outlook.improveCount + outlook.stayCount).toBe(1081);
    // 每一行都要和标注的「提升 / 保持」一致。
    for (const row of outlook.rows) {
      expect(row.change).toBe(
        row.category > outlook.currentCategory ? 'improve' : 'same',
      );
    }
    // 一对 -> 四条只有一种后续：剩下两张 A。
    const quads = outlook.rows.find(
      (row) => row.category === HandCategory.Quads,
    );
    expect(quads?.count).toBe(1);
    expect(outlook.bestCategory).toBe(HandCategory.Quads);
  });

  it('分布与听牌面板互相对得上（同花 = 同花 + 同花顺）', () => {
    const scenario = make('As Ks', 'Qs 7s 2h');
    const outlook = analyzeHeroOutlook(scenario);
    const draws = analyzeHeroDraws(scenario);
    const flushDraw = draws.rows.find((row) => row.target === HandCategory.Flush);
    const flush = outlook.rows.find((row) => row.category === HandCategory.Flush);
    const straightFlush = outlook.rows.find(
      (row) => row.category === HandCategory.StraightFlush,
    );
    expect(flushDraw).toBeDefined();
    // 听牌面板的 finalCount 是把「同花顺」也算进同花的（只要有同花就算补成）。
    expect((flush?.count ?? 0) + (straightFlush?.count ?? 0)).toBe(
      flushDraw?.completion.finalCount,
    );
  });

  it('经典听牌数字：两头顺最终 340 / 1081', () => {
    const outlook = analyzeHeroOutlook(make('7h 6h', '5c 4d 2s'));
    const straight = outlook.rows.find(
      (row) => row.category === HandCategory.Straight,
    );
    expect(straight?.count).toBe(340);
    expect(outlook.bestCategory).toBe(HandCategory.Straight);
  });

  it('转牌圈只剩 46 个后续，河牌圈已经定型', () => {
    const turn = analyzeHeroOutlook(make('Ah Kc', 'Qh Jh 2s 9d'));
    expect(turn.total).toBe(46);
    expect(turn.remainingBoardCards).toBe(1);
    expect(turn.rows.reduce((sum, row) => sum + row.count, 0)).toBe(46);

    const river = analyzeHeroOutlook(make('As Ad', 'Ah Kc Kd Ks 2h'));
    expect(river.total).toBe(1);
    expect(river.remainingBoardCards).toBe(0);
    expect(river.rows).toHaveLength(1);
    expect(river.rows[0].category).toBe(HandCategory.FullHouse);
    expect(river.rows[0].probability).toBe(1);
    expect(river.improveCount).toBe(0);
    expect(river.bestCategory).toBeNull();
  });

  it('牌力只可能变强：随机翻牌场景里最终牌型 >= 当前牌型', () => {
    const heroes = ['As Kd', '7h 6h', 'Qc Jd', '2c 4h'];
    const boards = ['Ah 8c 3d', 'Kh 9s 2h', '5c 4d 2s', 'Jc Ts 7d'];
    let checked = 0;
    for (const hero of heroes) {
      for (const board of boards) {
        const scenario = make(hero, board);
        // 交叉组合里可能出现同一张牌，这类场景直接跳过。
        const keys = new Set(parseCards(`${hero} ${board}`).map(cardKey));
        if (keys.size !== 5) continue;
        checked += 1;
        const outlook = analyzeHeroOutlook(scenario);
        expect(outlook.worsenCount).toBe(0);
        for (const row of outlook.rows) {
          expect(row.category).toBeGreaterThanOrEqual(outlook.currentCategory);
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
