/**
 * 「当前这几张牌是什么类型」——把 Hero 的底牌 + 已发出的公共牌
 * 归类成一个可记的牌型名称，例如「顶对 + 同花听牌 ♠」。
 *
 * 为什么要归类：同样是一对，超对 / 顶对 / 中对 / 底对 / 公共牌对
 * 的实战含义完全不同；再叠上听牌，就变成「顶对 + 同花听牌」这类
 * 一眼能叫出名字的组合。这里把这些口径固定下来，全部由牌面推导。
 *
 * 顺子 / 同花这一档直接用评价器（顺子、同花本身没有位置之分），
 * 只有「高牌」「一对」这两个大类需要看底牌与公共牌的位置关系。
 */

import type { Card, Scenario } from './cards';
import { RANK_VALUES, boardCards, knownCards } from './cards';
import type { HeroDrawAnalysis, HeroDrawRow } from './draws';
import { analyzeHeroDraws } from './draws';
import type { HandValue } from './evaluator';
import {
  describeHandValue,
  evaluateBestHand,
  HAND_CATEGORY_LABELS,
  HandCategory,
} from './evaluator';

/** 一对的位置细分。 */
export type PairPosition =
  | 'overpair'
  | 'top-pair'
  | 'middle-pair'
  | 'bottom-pair'
  | 'underpair'
  | 'board-pair';

export const PAIR_POSITION_LABELS: Record<PairPosition, string> = {
  overpair: '超对',
  'top-pair': '顶对',
  'middle-pair': '中对',
  'bottom-pair': '底对',
  underpair: '小对子',
  'board-pair': '公共牌对',
};

export interface FiveCardDrawSummary {
  /** 听牌名称（与听牌面板一致），例如「同花听牌 ♠」。 */
  label: string;
  /** 立即听牌的补牌张数；后门听牌为 0。 */
  outs: number;
  backdoor: boolean;
  /** 下一张牌就补成的概率。 */
  nextProbability: number;
  /** 发完剩余公共牌前补成的概率。 */
  finalProbability: number;
}

export interface FiveCardSummary {
  /** 已成牌的归类名：超对 / 顶对 / 中对 / 底对 / 小对子 / 公共牌对 / 两对 … */
  madeHand: string;
  /** 这个归类的依据，例如「配对公共牌最大牌 K」。 */
  detail: string;
  category: HandCategory;
  categoryLabel: string;
  /** 一对的位置细分；不是一对时为 null。 */
  pairPosition: PairPosition | null;
  /** 两张底牌里比公共牌最大牌还大的张数（0 / 1 / 2）。 */
  overcards: number;
  /** 完全没有成牌（只有高牌）。 */
  isAir: boolean;
  /** 听牌摘要（含后门），立即听牌在前。 */
  draws: FiveCardDrawSummary[];
  /** 同花听牌与顺子听牌同时存在（经典的 combo draw）。 */
  comboDraw: boolean;
  /** 归类名：「顶对 + 同花听牌 ♠」。 */
  summary: string;
  /** 归类大类，用来决定配色。 */
  kind: 'strong' | 'made' | 'draw' | 'air';
}

/** 公共牌的点数（去重，从大到小）。 */
function boardValues(board: readonly Card[]): number[] {
  return [...new Set(board.map((card) => RANK_VALUES[card.rank]))].sort(
    (a, b) => b - a,
  );
}

/** 公共牌里成对的那个点数（没有则为 null）。 */
function pairedBoardRank(board: readonly Card[]): Card | null {
  return (
    board.find(
      (card, index) => board.findIndex((c) => c.rank === card.rank) !== index,
    ) ?? null
  );
}

function overcardCount(hero: readonly Card[], board: readonly Card[]): number {
  const max = boardValues(board)[0] ?? 0;
  return hero.filter((card) => RANK_VALUES[card.rank] > max).length;
}

/**
 * 一对的位置：先看是不是口袋对，再看配中的是公共牌里的哪一张。
 * 返回 null 表示这一对来自公共牌自己成对，底牌两张都只是踢脚。
 */
export function classifyPair(
  hero: readonly Card[],
  board: readonly Card[],
): { position: PairPosition; detail: string } | null {
  const [first, second] = hero;
  if (first.rank === second.rank) {
    const value = RANK_VALUES[first.rank];
    const pair = `${first.rank}${second.rank}`;
    return value > (boardValues(board)[0] ?? 0)
      ? { position: 'overpair', detail: `口袋 ${pair}，比公共牌最大牌还大` }
      : { position: 'underpair', detail: `口袋 ${pair}，小于公共牌最大牌` };
  }

  const pairedRank = hero.find((card) =>
    board.some((boardCard) => boardCard.rank === card.rank),
  );
  if (pairedRank === undefined) {
    const boardPair = pairedBoardRank(board);
    return {
      position: 'board-pair',
      detail: boardPair
        ? `公共牌 ${boardPair.rank}${boardPair.rank} 成对，底牌两张都是踢脚`
        : '公共牌成对',
    };
  }

  const values = boardValues(board);
  const index = values.indexOf(RANK_VALUES[pairedRank.rank]);
  const position: PairPosition =
    index === 0
      ? 'top-pair'
      : index === values.length - 1
        ? 'bottom-pair'
        : 'middle-pair';
  const where =
    position === 'top-pair'
      ? '公共牌最大牌'
      : position === 'bottom-pair'
        ? '公共牌最小牌'
        : '公共牌中间牌';
  return { position, detail: `配中${where} ${pairedRank.rank}` };
}

/** 高牌（没有成牌）时的说明：最大牌 + 有几张高张。 */
function classifyHighCard(
  hero: readonly Card[],
  board: readonly Card[],
): { detail: string; overcards: number } {
  const all = [...hero, ...board];
  const max = all.reduce(
    (best, card) => (RANK_VALUES[card.rank] > RANK_VALUES[best.rank] ? card : best),
    all[0],
  );
  const overcards = overcardCount(hero, board);
  const overText =
    overcards === 2 ? '两张高张' : overcards === 1 ? '一张高张' : '两张都是小牌';
  return { detail: `${max.rank} 高，${overText}`, overcards };
}

/** 三条细分：暗三条（口袋对配中公共牌）/ 明三条（底牌配中公共牌的对子）/ 公共牌三条。 */
function classifyTrips(hero: readonly Card[], board: readonly Card[]): string {
  const counts = new Map<string, number>();
  for (const card of [...hero, ...board]) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  const tripled = [...counts.entries()].find(([, count]) => count >= 3)?.[0];
  if (tripled === undefined) return '三条';

  const [first, second] = hero;
  if (first.rank === second.rank && first.rank === tripled) {
    return `暗三条：口袋 ${first.rank}${second.rank} 配中公共牌`;
  }
  if (hero.some((card) => card.rank === tripled)) {
    return `明三条：底牌 ${tripled} 配中公共牌的对子`;
  }
  return `公共牌三条：公共牌自己就有 ${tripled}${tripled}${tripled}，底牌只提供踢脚`;
}

function madeHandOf(
  hero: readonly Card[],
  board: readonly Card[],
  value: HandValue,
): {
  madeHand: string;
  detail: string;
  pairPosition: PairPosition | null;
  overcards: number;
  isAir: boolean;
} {
  const label = HAND_CATEGORY_LABELS[value.category];
  const overcards = overcardCount(hero, board);

  if (value.category === HandCategory.OnePair) {
    const pair = classifyPair(hero, board);
    return pair === null
      ? {
          madeHand: label,
          detail: `公共牌成对：${describeHandValue(value)}`,
          pairPosition: null,
          overcards,
          isAir: false,
        }
      : {
          madeHand: PAIR_POSITION_LABELS[pair.position],
          detail: pair.detail,
          pairPosition: pair.position,
          overcards,
          isAir: false,
        };
  }

  if (value.category === HandCategory.Trips) {
    return {
      madeHand: label,
      detail: classifyTrips(hero, board),
      pairPosition: null,
      overcards,
      isAir: false,
    };
  }

  if (value.category === HandCategory.HighCard) {
    const high = classifyHighCard(hero, board);
    return {
      madeHand: label,
      detail: high.detail,
      pairPosition: null,
      overcards: high.overcards,
      isAir: true,
    };
  }

  return {
    madeHand: label,
    detail: describeHandValue(value),
    pairPosition: null,
    overcards,
    isAir: false,
  };
}

function drawSummary(row: HeroDrawRow): FiveCardDrawSummary {
  return {
    label: row.label,
    outs: row.backdoor ? 0 : row.completion.outs.length,
    backdoor: row.backdoor,
    nextProbability: row.completion.nextProbability,
    finalProbability: row.completion.finalProbability,
  };
}

/**
 * 把当前牌面归类成一句话。
 *
 * @param scenario 当前牌面（底牌 + 已发出的公共牌）
 * @param heroDraws 已经算好的听牌结果，传入可避免重复枚举
 */
export function summarizeFiveCardHand(
  scenario: Scenario,
  heroDraws?: HeroDrawAnalysis,
): FiveCardSummary {
  const hero = scenario.hero;
  const board = boardCards(scenario);
  const value = evaluateBestHand(knownCards(scenario));
  const made = madeHandOf(hero, board, value);
  const draws = (heroDraws ?? analyzeHeroDraws(scenario)).rows.map(drawSummary);

  const comboDraw =
    draws.some((draw) => !draw.backdoor && draw.label.startsWith('同花')) &&
    draws.some((draw) => !draw.backdoor && draw.label.startsWith('顺子'));

  const kind: FiveCardSummary['kind'] =
    value.category >= HandCategory.Straight
      ? 'strong'
      : draws.length > 0
        ? 'draw'
        : value.category >= HandCategory.OnePair
          ? 'made'
          : 'air';

  const summary =
    made.isAir && draws.length === 0
      ? '空气（没有成牌，也没有听牌）'
      : [made.madeHand, ...draws.map((draw) => draw.label)].join(' + ');

  return {
    madeHand: made.madeHand,
    detail: made.detail,
    category: value.category,
    categoryLabel: HAND_CATEGORY_LABELS[value.category],
    pairPosition: made.pairPosition,
    overcards: made.overcards,
    isAir: made.isAir,
    draws,
    comboDraw,
    summary,
    kind,
  };
}
