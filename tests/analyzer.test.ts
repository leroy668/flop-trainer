import { describe, expect, it } from 'vitest';
import { analyzeFlopScenario, TOTAL_OPPONENT_COMBOS } from '../src/poker/analyzer';
import {
  evaluateFiveCards,
  HandCategory,
  rankValueToLabel,
} from '../src/poker/evaluator';
import { generateRandomFlopScenario } from '../src/poker/randomScenario';
import { getRankGroup } from '../src/poker/grouping';
import type { RankGroupAnalysis } from '../src/poker/analyzer';
import type { HoleCards } from '../src/poker/combinations';
import type { Card } from '../src/poker/cards';
import { scenario } from './helpers';

const FIXTURE = scenario('As Kd', 'Ah 8c 3d');

describe('核心分析不变量', () => {
  const analysis = analyzeFlopScenario(FIXTURE);

  it('总组合数恒为 1081', () => {
    expect(analysis.totalOpponentCombos).toBe(TOTAL_OPPONENT_COMBOS);
    expect(analysis.results).toHaveLength(TOTAL_OPPONENT_COMBOS);
  });

  it('领先 + 平手 + 落后 = 1081', () => {
    expect(analysis.aheadCount + analysis.tieCount + analysis.behindCount).toBe(
      TOTAL_OPPONENT_COMBOS,
    );
  });

  it('三个概率之和约为 1', () => {
    expect(
      analysis.aheadProbability +
        analysis.tieProbability +
        analysis.behindProbability,
    ).toBeCloseTo(1, 10);
  });

  it('所有牌型的 aheadCount 之和 = 总 aheadCount', () => {
    const sum = analysis.byCategory.reduce((acc, item) => acc + item.aheadCount, 0);
    expect(sum).toBe(analysis.aheadCount);
  });

  it('所有牌型的 totalCount 之和 = 1081', () => {
    const sum = analysis.byCategory.reduce((acc, item) => acc + item.totalCount, 0);
    expect(sum).toBe(TOTAL_OPPONENT_COMBOS);
  });

  it('每个牌型的 RankGroup.comboCount 之和 = 该牌型 aheadCount', () => {
    for (const entry of analysis.byCategory) {
      const sum = entry.groups.reduce((acc, group) => acc + group.comboCount, 0);
      expect(sum).toBe(entry.aheadCount);
    }
  });

  it('同牌型 ahead + tie + behind = total', () => {
    const same = analysis.sameCategory;
    expect(same.aheadCount + same.tieCount + same.behindCount).toBe(same.totalCount);
  });

  it('同牌型条件概率之和约为 1', () => {
    const same = analysis.sameCategory;
    if (same.totalCount > 0) {
      expect(
        same.aheadConditionalProbability +
          same.tieConditionalProbability +
          same.behindConditionalProbability,
      ).toBeCloseTo(1, 10);
    }
  });

  it('同牌型领先组合聚合后数量一致', () => {
    const sum = analysis.sameCategory.aheadGroups.reduce(
      (acc, group) => acc + group.comboCount,
      0,
    );
    expect(sum).toBe(analysis.sameCategory.aheadCount);
  });

  it('不可能出现的牌型 totalCount 与 aheadCount 都为 0', () => {
    for (const entry of analysis.byCategory) {
      if (entry.totalCount === 0) expect(entry.aheadCount).toBe(0);
    }
  });

  it('只有 aheadCount > 0 的牌型才算能压过 Hero', () => {
    const beaters = analysis.byCategory.filter((entry) => entry.aheadCount > 0);
    // 理论上同牌型更高也可能压过，因此不能简单用 category 比较。
    for (const entry of beaters) {
      expect(entry.aheadCount).toBeGreaterThan(0);
    }
  });

  it('领先组合中不会出现已知牌', () => {
    const used = new Set(
      [...FIXTURE.hero, ...FIXTURE.flop].map((c) => `${c.rank}${c.suit}`),
    );
    for (const result of analysis.results) {
      if (result.comparison !== 'ahead') continue;
      for (const card of result.holeCards) {
        expect(used.has(`${card.rank}${card.suit}`)).toBe(false);
      }
    }
  });

  it('Hero 牌力为 一对A，K踢脚', () => {
    expect(analysis.heroHandValue.category).toBe(HandCategory.OnePair);
    expect(analysis.heroHandValue.tiebreak).toEqual([14, 13, 8, 3]);
  });

  it('每个 result 的 category 与 handValue.category 一致', () => {
    for (const result of analysis.results) {
      expect(result.category).toBe(result.handValue.category);
    }
  });
});

describe('一对：同牌型内部同样把概率相同的点数合并成一行', () => {
  // Hero 是一对8；「同牌型」里要看清到底哪些对子能压过 Hero。
  const analysis = analyzeFlopScenario(scenario('8s 7s', '8d Kc 2h'));
  const aheadGroups = analysis.sameCategory.aheadGroups;

  it('Hero 确实是一对', () => {
    expect(analysis.heroHandValue.category).toBe(HandCategory.OnePair);
    expect(analysis.sameCategory.category).toBe(HandCategory.OnePair);
  });

  it('概率相同的点数合并，概率不同的各自成行，行名保留二级分类', () => {
    expect(aheadGroups.map((g) => g.label)).toEqual([
      '配对公共牌 K',
      '配对公共牌 8',
      '口袋对 A / Q / J / T / 9',
    ]);
    expect(aheadGroups.map((g) => g.comboCount)).toEqual([117, 40, 30]);
  });

  it('各组组合数之和 = 同牌型 aheadCount', () => {
    expect(aheadGroups.reduce((acc, g) => acc + g.comboCount, 0)).toBe(
      analysis.sameCategory.aheadCount,
    );
    for (const group of aheadGroups) {
      expect(group.combos).toHaveLength(group.comboCount);
    }
  });

  it('同牌型总数 369，其中 187 个比你大（「占同牌型」条件概率的两个分子分母）', () => {
    expect(analysis.sameCategory.totalCount).toBe(369);
    expect(analysis.sameCategory.aheadCount).toBe(187);
    expect(
      analysis.sameCategory.aheadCount / analysis.sameCategory.totalCount,
    ).toBeCloseTo(0.5068, 4);
  });

  it('行内每个成员点数组合数相同，且与二级分类一致', () => {
    for (const group of aheadGroups) {
      const isPocketSubgroup = group.label.startsWith('口袋对');
      const members = group.label.split(' ').slice(1).join(' ').split(' / ');
      const counts = new Map<string, number>();
      for (const combo of group.combos) {
        const value = evaluateFiveCards([...combo, ...analysis.scenario.flop]);
        expect(value.category).toBe(HandCategory.OnePair);
        const isPocket = combo[0].rank === combo[1].rank;
        expect(isPocket).toBe(isPocketSubgroup);
        const token = rankValueToLabel(value.tiebreak[0]);
        expect(members).toContain(token);
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
      expect(counts.size).toBe(members.length);
      for (const count of counts.values()) {
        expect(count).toBe(group.comboCount / members.length);
      }
    }
  });
});

describe('另一个场景的不变量（随机抽查）', () => {
  const scenarios = [
    scenario('7h 7d', 'Ks Qs Js'),
    scenario('Ah Kh', 'Qh Jh Th'),
    scenario('2c 2d', 'As Kd Qh'),
    scenario('9s 8s', '7s 6s 2d'),
  ];

  for (const s of scenarios) {
    it(`${s.hero[0].rank}${s.hero[1].rank} / ${s.flop.map((c) => c.rank).join('')}`, () => {
      const analysis = analyzeFlopScenario(s);
      expect(analysis.aheadCount + analysis.tieCount + analysis.behindCount).toBe(
        TOTAL_OPPONENT_COMBOS,
      );
      const categorySum = analysis.byCategory.reduce(
        (acc, item) => acc + item.aheadCount,
        0,
      );
      expect(categorySum).toBe(analysis.aheadCount);
      const same = analysis.sameCategory;
      expect(same.aheadCount + same.tieCount + same.behindCount).toBe(same.totalCount);
    });
  }
});

describe('一对：把「能压过你的牌型」里概率相同的点数合成一行', () => {
  // Hero 高牌（Q♥7♠，翻牌 6♣K♣9♣），一对全部压过 Hero。
  const analysis = analyzeFlopScenario(scenario('Qh 7s', '6c Kc 9c'));
  const pair = analysis.byCategory.find(
    (entry) => entry.category === HandCategory.OnePair,
  )!;

  it('同类里概率相同的点数合为一行，行名列出全部点数', () => {
    expect(pair.groups.map((g) => g.label)).toEqual([
      '配对公共牌 K / 9 / 6',
      '口袋对 A / J / T / 8 / 5 / 4 / 3 / 2',
      '口袋对 Q / 7',
    ]);
  });

  it('配对公共牌 = K/9/6 各 114 合并成 342；口袋对 = 48 + 6 = 54', () => {
    expect(pair.groups.map((g) => g.comboCount)).toEqual([342, 48, 6]);
    expect(pair.groups[1].probability).toBeCloseTo(48 / 1081, 10);
    expect(pair.groups[2].probability).toBeCloseTo(6 / 1081, 10);
  });

  it('memberCount 反映出「单个点数」各自的组合数与概率', () => {
    expect(pair.groups.map((g) => g.memberCount)).toEqual([3, 8, 2]);
    // 配对公共牌 K / 9 / 6：合计 342（114 × 3），单个 114。
    expect(pair.groups[0].comboCount / pair.groups[0].memberCount).toBe(114);
    expect(
      pair.groups[0].probability / pair.groups[0].memberCount,
    ).toBeCloseTo(114 / 1081, 10);
    // 口袋对 Q / 7 被 Hero 挡牌，各只有 3 个组合。
    expect(pair.groups[2].comboCount / pair.groups[2].memberCount).toBe(3);
  });

  it('合并后组合数之和仍等于该牌型 aheadCount', () => {
    expect(pair.groups.reduce((acc, g) => acc + g.comboCount, 0)).toBe(
      pair.aheadCount,
    );
    for (const group of pair.groups) {
      expect(group.combos).toHaveLength(group.comboCount);
    }
  });

  it('每一行里的每个组合都确实属于行名列出的二级分类，且点数相同', () => {
    for (const group of pair.groups) {
      const isPocketSubgroup = group.label.startsWith('口袋对');
      const pairRanks = new Set<number>();
      for (const combo of group.combos) {
        const value = evaluateFiveCards([...combo, ...analysis.scenario.flop]);
        expect(value.category).toBe(HandCategory.OnePair);
        pairRanks.add(value.tiebreak[0]);
        const isPocket = combo[0].rank === combo[1].rank;
        expect(isPocket).toBe(isPocketSubgroup);
      }
      // 合并前提就是「概率相同」：每个点数占用同样多的组合数。
      const listed = group.label.split(' ').slice(1).join(' ').split(' / ');
      expect(listed).toHaveLength(pairRanks.size);
      expect(listed).toHaveLength(group.memberCount);
      expect(group.comboCount % listed.length).toBe(0);
    }
  });

  it('合并后不再需要二级分类小标题（行名本身就是分类）', () => {
    for (const group of pair.groups) {
      expect(group.subgroup).toBeUndefined();
    }
  });

  it('其他牌型不带二级分类', () => {
    for (const entry of analysis.byCategory) {
      if (entry.category === HandCategory.OnePair) continue;
      for (const group of entry.groups) {
        expect(group.subgroup).toBeUndefined();
      }
    }
  });
});

describe('同花：按高张分类', () => {
  // 三张公共牌同花色，同花只可能以这种方式出现。
  const analysis = analyzeFlopScenario(scenario('2h 3d', 'Ks 9s 4s'));
  const flush = analysis.byCategory.find(
    (entry) => entry.category === HandCategory.Flush,
  )!;

  it('全部 45 个同花组合都压过高牌 Hero', () => {
    expect(analysis.heroHandValue.category).toBe(HandCategory.HighCard);
    expect(flush.totalCount).toBe(45);
    expect(flush.aheadCount).toBe(45);
  });

  it('合并为「A高同花 / K高同花」两类，不再逐张列 45 行', () => {
    expect([...flush.groups.map((g) => g.label)].sort()).toEqual([
      'A高同花',
      'K高同花',
    ]);
    const countOf = (label: string) =>
      flush.groups.find((g) => g.label === label)!.comboCount;
    expect(countOf('A高同花')).toBe(9);
    expect(countOf('K高同花')).toBe(36);
  });

  it('标签确实等于该组 5 张牌的高张', () => {
    for (const group of flush.groups) {
      for (const combo of group.combos) {
        const value = evaluateFiveCards([...combo, ...analysis.scenario.flop]);
        expect(value.category).toBe(HandCategory.Flush);
        expect(group.label).toBe(
          `${rankValueToLabel(value.tiebreak[0])}高同花`,
        );
      }
    }
  });

  it('各组组合数之和 = aheadCount', () => {
    expect(flush.groups.reduce((acc, g) => acc + g.comboCount, 0)).toBe(
      flush.aheadCount,
    );
  });

  it('Hero 自己持同花时，同牌型的分组也用高张分类', () => {
    const own = analyzeFlopScenario(scenario('8s 7s', 'Ts 5s 2s'));
    expect(own.heroHandValue.category).toBe(HandCategory.Flush);
    const same = own.sameCategory;
    expect(same.category).toBe(HandCategory.Flush);
    expect(same.aheadCount).toBeGreaterThan(0);
    for (const group of same.aheadGroups) {
      expect(group.label.endsWith('高同花')).toBe(true);
    }
    expect(
      same.aheadGroups.reduce((acc, g) => acc + g.comboCount, 0),
    ).toBe(same.aheadCount);
  });
});

describe('翻牌圈限制：某些牌型根本不可能出现', () => {
  // Hero A♥T♦，翻牌 6♣ J♠ 4♠：
  // 公共牌点数 4 / 6 / J 跨度为 7，两张手牌无法凑出 5 张连牌；
  // 黑桃只有 2 张，也做不成同花。因此顺子 / 同花等全部不存在。
  const analysis = analyzeFlopScenario(scenario('Ah Td', '6c Js 4s'));

  it('Hero 是局牌（高牌）', () => {
    expect(analysis.heroHandValue.category).toBe(HandCategory.HighCard);
  });

  it('顺子 / 同花 / 葫芦 / 四条 / 同花顺 均为 0 个组合', () => {
    for (const category of [
      HandCategory.Straight,
      HandCategory.Flush,
      HandCategory.FullHouse,
      HandCategory.Quads,
      HandCategory.StraightFlush,
    ]) {
      const entry = analysis.byCategory.find((c) => c.category === category)!;
      expect(entry.totalCount).toBe(0);
      expect(entry.aheadCount).toBe(0);
    }
  });

  it('能压过高牌的只有高牌 / 一对 / 两对 / 三条，且之和 = 总 ahead', () => {
    const beating = analysis.byCategory.filter((c) => c.aheadCount > 0);
    expect(beating.map((c) => c.category)).toEqual([
      HandCategory.HighCard,
      HandCategory.OnePair,
      HandCategory.TwoPair,
      HandCategory.Trips,
    ]);
    expect(beating.reduce((acc, c) => acc + c.aheadCount, 0)).toBe(
      analysis.aheadCount,
    );
  });
});

describe('其他牌型：概率相同的类型也合并成一行，行名保留成员', () => {
  const analysis = analyzeFlopScenario(scenario('Ah 3h', '7c 5c 4c'));
  const entry = (category: HandCategory) =>
    analysis.byCategory.find((e) => e.category === category)!;
  const labels = (category: HandCategory) =>
    entry(category).groups.map((g) => g.label);

  it('同花：8高同花 / 7高同花 概率相同（各 2 个），合成一行', () => {
    expect(labels(HandCategory.Flush)).toEqual([
      'A高同花',
      'K高同花',
      'Q高同花',
      'J高同花',
      'T高同花',
      '9高同花',
      '8 / 7高同花',
    ]);
    const merged = entry(HandCategory.Flush).groups.at(-1)!;
    expect(merged.comboCount).toBe(4);
    expect(merged.probability).toBeCloseTo(4 / 1081, 10);
  });

  it('两对 / 三条 / 同花顺 也都按概率相同合并', () => {
    expect(labels(HandCategory.TwoPair)).toEqual(['75 / 74 / 54']);
    expect(labels(HandCategory.Trips)).toEqual(['77 / 55 / 44']);
    expect(labels(HandCategory.StraightFlush)).toEqual(['86 / 63']);
  });

  it('合并行内每个成员组合数相同（= 总数 / 成员数）', () => {
    const flush = entry(HandCategory.Flush).groups.at(-1)!;
    expect(flush.label).toBe('8 / 7高同花');
    expect(flush.label.replace(/高同花$/, '').split(' / ')).toEqual(['8', '7']);
    expect(flush.comboCount).toBe(4);
    expect(flush.memberCount).toBe(2);
    expect(flush.comboCount / flush.memberCount).toBe(2);
  });

  it('未合并的行 memberCount 为 1（单个高张就是它自己的概率）', () => {
    const single = entry(HandCategory.Flush).groups.find(
      (g) => g.label === 'A高同花',
    )!;
    expect(single.memberCount).toBe(1);
    expect(single.comboCount).toBe(9);
    expect(single.comboCount / single.memberCount).toBe(9);
  });

  it('高牌也会合并（AK / AQ 概率相同）', () => {
    const other = analyzeFlopScenario(scenario('Ah Td', '6c Js 4s'));
    const high = other.byCategory.find(
      (e) => e.category === HandCategory.HighCard,
    )!;
    expect(high.groups.map((g) => g.label)).toEqual(['AK / AQ']);
    expect(high.groups[0].comboCount).toBe(24);
  });
});

describe('合并不变量：每个合并行内的成员概率确实相同', () => {
  /** 一个组合在它所属牌型里的「成员短名」。 */
  const tokenOf = (
    category: HandCategory,
    combo: HoleCards,
    flop: readonly Card[],
  ) => {
    const value = evaluateFiveCards([...combo, ...flop]);
    if (category === HandCategory.OnePair || category === HandCategory.Flush) {
      return rankValueToLabel(value.tiebreak[0]);
    }
    return getRankGroup(combo);
  };

  /** 从行名里拆出成员短名。 */
  const membersOf = (label: string) => {
    if (label.startsWith('配对公共牌 ') || label.startsWith('口袋对 ')) {
      return label.split(' ').slice(1).join(' ').split(' / ');
    }
    return label.replace(/高同花$/, '').split(' / ');
  };

  const violationsOf = (
    category: HandCategory,
    groups: RankGroupAnalysis[],
    flop: readonly Card[],
    where: string,
  ): string[] => {
    const problems: string[] = [];
    for (const group of groups) {
      const members = membersOf(group.label);
      const counts = new Map<string, number>();
      for (const combo of group.combos) {
        const token = tokenOf(category, combo, flop);
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
      if ([...counts.keys()].sort().join() !== [...members].sort().join()) {
        problems.push(`${where} ${group.label}：成员名与实际点数不符`);
        continue;
      }
      const per = group.comboCount / members.length;
      if (group.memberCount !== members.length) {
        problems.push(`${where} ${group.label}：memberCount 与行名成员数不符`);
      }
      for (const count of counts.values()) {
        if (count !== per) {
          problems.push(`${where} ${group.label}：行内成员组合数不同（${count} vs ${per}）`);
          break;
        }
      }
    }
    return problems;
  };

  it('随机 150 个场景的每个分组都满足', () => {
    const violations: string[] = [];
    for (let i = 0; i < 150; i += 1) {
      const analysis = analyzeFlopScenario(generateRandomFlopScenario());
      for (const entry of analysis.byCategory) {
        violations.push(
          ...violationsOf(
            entry.category,
            entry.groups,
            analysis.scenario.flop,
            '能压过',
          ),
        );
      }
      violations.push(
        ...violationsOf(
          analysis.sameCategory.category,
          analysis.sameCategory.aheadGroups,
          analysis.scenario.flop,
          '同牌型',
        ),
      );
    }
    expect(violations).toEqual([]);
  });
});
