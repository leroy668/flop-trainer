import { describe, expect, it } from 'vitest';
import {
  BOARD_TEXTURE_LEVELS,
  boardTextureDims,
  boardTextureKeys,
  buildBoardTextureAtlas,
  lookupBoard,
} from '../src/poker/boardTexture';
import type { Card } from '../src/poker/cards';
import { createDeck } from '../src/poker/cards';
import { cards, tuple3 } from './helpers';

const atlas = buildBoardTextureAtlas();

/** 花色整体改名：s <-> h。 */
function swapSuits(triple: [Card, Card, Card]): [Card, Card, Card] {
  return triple.map((card) => ({
    rank: card.rank,
    suit: card.suit === 's' ? 'h' : card.suit === 'h' ? 's' : card.suit,
  })) as [Card, Card, Card];
}

describe('buildBoardTextureAtlas', () => {
  it('枚举全部 22,100 种翻牌', () => {
    expect(atlas.totalFlops).toBe(22100);
  });

  it('三个层级的类别数：1,755 / 379 / 247', () => {
    expect(atlas.levels.strategic.classCount).toBe(1755);
    expect(atlas.levels.shape.classCount).toBe(379);
    expect(atlas.levels.coarse.classCount).toBe(247);
  });

  it('每一层的权重之和等于 22,100，占比之和等于 1', () => {
    for (const level of BOARD_TEXTURE_LEVELS) {
      const view = atlas.levels[level];
      const sum = view.rows.reduce((total, row) => total + row.count, 0);
      const probabilitySum = view.rows.reduce(
        (total, row) => total + row.probability,
        0,
      );
      expect(sum).toBe(22100);
      expect(probabilitySum).toBeCloseTo(1, 10);
      // 分组只是把明细行拼起来，数字不能变
      expect(view.sections.reduce((total, s) => total + s.count, 0)).toBe(22100);
      expect(view.sections.reduce((total, s) => total + s.classCount, 0)).toBe(
        view.classCount,
      );
    }
  });

  it('成对情况：无对 18,304 / 带对 3,744 / 三条 52', () => {
    expect(atlas.pairingTotals.map((entry) => [entry.value, entry.count])).toEqual(
      [
        ['unpaired', 18304],
        ['pair', 3744],
        ['trips', 52],
      ],
    );
  });

  it('花色分布：单色 1,144 / 两色 12,168 / 彩虹 8,788', () => {
    expect(atlas.suitTotals.map((entry) => [entry.value, entry.count])).toEqual([
      ['two-tone', 12168],
      ['rainbow', 8788],
      ['monotone', 1144],
    ]);
    expect(atlas.suitTotals[0].probability).toBeCloseTo(12168 / 22100, 12);
  });

  it('策略牌面的类权重只可能是 4 / 12 / 24（单色 / 两色 / 彩虹）', () => {
    const byWeight = new Map<number, number>();
    for (const row of atlas.levels.strategic.rows) {
      expect([4, 12, 24]).toContain(row.count);
      byWeight.set(row.count, (byWeight.get(row.count) ?? 0) + 1);
    }
    expect(byWeight.get(4)).toBe(299); // 无对单色 286 + 三条 13
    expect(byWeight.get(12)).toBe(1170); // 无对两色 858 + 带对两色 312
    expect(byWeight.get(24)).toBe(286); // 无对彩虹 286
    const total = [...byWeight.entries()].reduce(
      (sum, [weight, size]) => sum + weight * size,
      0,
    );
    expect(total).toBe(22100);
  });

  it('策略牌面里最大的一类占 24 / 22100（彩虹：每种点数组合只有一种花色排法）', () => {
    expect(atlas.levels.strategic.rows[0].count).toBe(24);
    expect(atlas.levels.strategic.rows[0].probability).toBeCloseTo(24 / 22100, 12);
  });

  it('每一层里类别名互不重复，且都带例子与概率', () => {
    for (const level of BOARD_TEXTURE_LEVELS) {
      const labels = atlas.levels[level].rows.map((row) => row.label);
      expect(new Set(labels).size).toBe(labels.length);
      for (const row of atlas.levels[level].rows) {
        expect(row.example).toHaveLength(3);
        expect(row.probability).toBeGreaterThan(0);
        expect(row.label.length).toBeGreaterThan(0);
        expect(row.sectionLabel.length).toBeGreaterThan(0);
      }
    }
  });

  it('重新枚举的结果一致（确定性）', () => {
    const again = buildBoardTextureAtlas();
    expect(again.levels.strategic.rows[0].label).toBe(
      atlas.levels.strategic.rows[0].label,
    );
    expect(again.levels.shape.classCount).toBe(379);
  });
});

describe('boardTextureKeys', () => {
  const deck = createDeck();

  it('花色整体置换不改变任何键', () => {
    const base = [deck[0], deck[1], deck[2]] as [Card, Card, Card];
    expect(boardTextureKeys(swapSuits(base))).toEqual(boardTextureKeys(base));
  });

  it('K72 与 A83 形状相同（点数整体平移）', () => {
    const a = tuple3('Ks 7h 2c');
    const b = tuple3('As 8h 3c');
    expect(boardTextureKeys(a).shape).toBe(boardTextureKeys(b).shape);
    expect(boardTextureKeys(a).strategic).not.toBe(boardTextureKeys(b).strategic);
  });

  it('形状级区分两色的「哪两张同花」，粗级别把它们合并', () => {
    const a = tuple3('As Ks Qd'); // A 与 K 同花
    const b = tuple3('Ah Ks Qs'); // K 与 Q 同花
    expect(boardTextureKeys(a).shape).not.toBe(boardTextureKeys(b).shape);
    expect(boardTextureKeys(a).coarse).toBe(boardTextureKeys(b).coarse);
  });

  it('同一形状下不同花色类别不会被合并', () => {
    const a = tuple3('Ks 7s 2c');
    const b = tuple3('Ah 8h 3h');
    expect(boardTextureKeys(a).shape).not.toBe(boardTextureKeys(b).shape);
    expect(boardTextureKeys(a).coarse).not.toBe(boardTextureKeys(b).coarse);
  });
});

describe('boardTextureDims', () => {
  const cases: Array<[string, string, string[]]> = [
    ['A♠K♠Q♦', 'As Ks Qd', ['unpaired', 'two-tone', 'triple-run']],
    ['A♣2♦3♥', 'Ac 2d 3h', ['unpaired', 'rainbow', 'triple-run']],
    ['K♥Q♠J♦', 'Kh Qs Jd', ['unpaired', 'rainbow', 'triple-run']],
    ['2♣3♦4♥', '2c 3d 4h', ['unpaired', 'rainbow', 'triple-run']],
    ['2♣4♦6♥', '2c 4d 6h', ['unpaired', 'rainbow', 'one-gapper']],
    ['2♣3♦8♥', '2c 3d 8h', ['unpaired', 'rainbow', 'double-run']],
    ['2♣5♦9♥', '2c 5d 9h', ['unpaired', 'rainbow', 'disconnected']],
    ['K♠J♠9♠', 'Ks Js 9s', ['unpaired', 'monotone', 'one-gapper']],
    ['A♠A♥A♦', 'As Ah Ad', ['trips', 'rainbow', 'trips']],
    ['7♥7♦2♣', '7h 7d 2c', ['pair', 'rainbow', 'kicker-far']],
    ['2♣2♦3♣', '2c 2d 3c', ['pair', 'two-tone', 'kicker-adjacent']],
    ['A♠2♦2♣', 'As 2d 2c', ['pair', 'rainbow', 'kicker-adjacent']],
    ['5♦5♥4♠', '5d 5h 4s', ['pair', 'rainbow', 'kicker-adjacent']],
  ];

  it.each(cases)('%s 的结构', (_name, hand, expected) => {
    const dims = boardTextureDims(tuple3(hand));
    expect([dims.pairing, dims.suitClass, dims.structure]).toEqual(expected);
  });

  it('A♠K♠Q♦ 的同花结构与点数串', () => {
    const triple = tuple3('As Ks Qd');
    expect(boardTextureDims(triple).suitStructureLabel).toBe('A + K 同花');
    expect(boardTextureDims(triple, 'positions').suitStructureLabel).toBe(
      '最高 + 中间 同花',
    );
    expect(boardTextureDims(triple).rankLabel).toBe('AKQ');
    expect(boardTextureDims(triple).highLabel).toBe('A 高');
  });

  it('A♣2♦3♥ 认作 A 低位的三连张', () => {
    const dims = boardTextureDims(tuple3('Ac 2d 3h'));
    expect(dims.structureLabel).toBe('三连张');
    expect(dims.rankLabel).toBe('A32');
  });

  it('带对的三种同花结构与三种踢脚距离', () => {
    expect(boardTextureDims(tuple3('2c 2d 3c')).suitStructureLabel).toBe(
      '踢脚与对子同花',
    );
    expect(boardTextureDims(tuple3('2c 2d 3h')).suitStructureLabel).toBe(
      '踢脚不同花',
    );
    expect(boardTextureDims(tuple3('2c 2d 4h')).structureLabel).toBe(
      '踢脚隔一张',
    );
    expect(boardTextureDims(tuple3('2c 2d 5h')).structureLabel).toBe('踢脚远离');
    expect(boardTextureDims(tuple3('As Ah Ad')).suitStructureLabel).toBe(
      '三张不同花',
    );
  });
  it('连张 / 间隔给的跨度是按点数平移不变的', () => {
    expect(boardTextureDims(tuple3('As Ks Qd')).relativeLabel).toBe(
      '跨度 2 · 间隔 1 + 1',
    );
    expect(boardTextureDims(tuple3('Ac 2d 3h')).relativeLabel).toBe(
      '跨度 12 · 间隔 1 + 11',
    );
    expect(boardTextureDims(tuple3('2c 2d 4h')).relativeLabel).toBe(
      '踢脚高 2 级',
    );
    expect(boardTextureDims(tuple3('As 2d 2c')).relativeLabel).toBe(
      '踢脚高 12 级',
    );
  });
});

describe('lookupBoard', () => {
  it('两色翻牌：策略类 12 种，形状类 132 种（点数平移后合并）', () => {
    const hit = lookupBoard(atlas, cards('As Ks Qd'));
    expect(hit.summary).toBe('无对 · 两色 · 三连张');
    expect(hit.entries.map((entry) => entry.count)).toEqual([12, 132, 396]);
    expect(hit.entries[0].label).toBe('AKQ · A + K 同花 · 三连张');
    expect(hit.entries[1].label).toBe(
      '无对 · 三连张（跨度 2 · 间隔 1 + 1） · 最高 + 中间 同花',
    );
    expect(hit.entries[2].label).toBe(
      '无对 · 三连张（跨度 2 · 间隔 1 + 1） · 两色',
    );
    expect(hit.entries[0].probability).toBeCloseTo(12 / 22100, 12);
  });

  it('单色 4 种、彩虹 24 种', () => {
    expect(lookupBoard(atlas, cards('As Ks Qs')).entries[0].count).toBe(4);
    const rainbow = lookupBoard(atlas, cards('As Kh Qd'));
    expect(rainbow.entries[0].count).toBe(24);
    expect(rainbow.entries[0].label).toBe('AKQ · 三张不同花 · 三连张');
  });

  it('带对 / 三条的类权重', () => {
    expect(lookupBoard(atlas, cards('7h 7d 2c')).entries[0].count).toBe(12);
    expect(lookupBoard(atlas, cards('As Ah Ad')).entries[0].count).toBe(4);
  });

  it('三层都能查到，且标签完整', () => {
    const hit = lookupBoard(atlas, cards('2c 2d 3c'));
    expect(hit.entries.map((entry) => entry.level)).toEqual([
      'strategic',
      'shape',
      'coarse',
    ]);
    expect(hit.entries[0].label).toBe('322 · 踢脚与对子同花 · 踢脚相邻');
    expect(hit.entries[1].label).toBe(
      '带对 · 踢脚相邻（踢脚高 1 级） · 踢脚与对子同花',
    );
    expect(hit.entries[2].label).toBe(
      '带对 · 踢脚相邻（踢脚高 1 级） · 两色',
    );
  });

  it('分类结果与输入一致（100 个随机翻牌）', () => {
    const deck = createDeck();
    for (let n = 0; n < 100; n += 1) {
      const i = Math.floor(Math.random() * 52);
      let j = Math.floor(Math.random() * 52);
      let k = Math.floor(Math.random() * 52);
      if (j === i) j = (j + 1) % 52;
      if (k === i || k === j) k = (k + 2) % 52;
      const triple = [deck[i], deck[j], deck[k]] as [Card, Card, Card];
      const dims = boardTextureDims(triple);
      const hit = lookupBoard(atlas, triple);
      expect(hit.summary).toBe(
        `${dims.pairingLabel} · ${dims.suitClassLabel} · ${dims.structureLabel}`,
      );
      for (const entry of hit.entries) {
        expect(entry.count).toBeGreaterThan(0);
        expect(entry.probability).toBeCloseTo(entry.count / 22100, 12);
      }
    }
  });

  it('非法输入会报错', () => {
    expect(() => lookupBoard(atlas, cards('As Ks'))).toThrow();
    expect(() => lookupBoard(atlas, cards('As As Qd'))).toThrow();
  });
});
