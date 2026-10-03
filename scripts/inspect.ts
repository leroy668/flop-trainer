/**
 * 手动检查脚本：
 *   npx vite-node scripts/inspect.ts
 *   npx vite-node scripts/inspect.ts --hero="As Kd" --board="Ah 8c 3d 2s 9h"
 * 打印指定场景的完整分析，便于人工核对。公共牌 3 张 = 翻牌圈，4 张 = 转牌圈，5 张 = 河牌圈。
 */
import { analyzeScenario } from '../src/poker/analyzer';
import { HAND_CATEGORY_LABELS, describeHandValue } from '../src/poker/evaluator';
import { parseCard, remainingBoardCards, STREET_LABELS, streetOf } from '../src/poker/cards';
import type { Scenario } from '../src/poker/cards';
import { analyzeDraws } from '../src/poker/draws';
import { formatPercent } from '../src/trainer/ranges';

function option(name: string): string | null {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).replace(/^"|"$/g, '') : null;
}

const heroInput = option('hero') ?? 'As Kd';
const boardInput = option('board') ?? 'Ah 8c 3d';

const hero = heroInput.split(/\s+/).map(parseCard);
const board = boardInput.split(/\s+/).map(parseCard);
const scenario: Scenario = {
  hero: [hero[0], hero[1]],
  flop: [board[0], board[1], board[2]],
  ...(board[3] ? { turn: board[3] } : {}),
  ...(board[4] ? { river: board[4] } : {}),
};

const analysis = analyzeScenario(scenario);
const street = streetOf(scenario);

console.log(`${STREET_LABELS[street]}（还要发 ${remainingBoardCards(scenario)} 张公共牌）`);
console.log('Hero:', describeHandValue(analysis.heroHandValue));
console.log(
  `总体: 领先 ${analysis.aheadCount} / 平手 ${analysis.tieCount} / 落后 ${analysis.behindCount} = ${analysis.totalOpponentCombos}`,
);
console.log(
  `概率: ${formatPercent(analysis.aheadProbability)} / ${formatPercent(
    analysis.tieProbability,
  )} / ${formatPercent(analysis.behindProbability)}`,
);

console.log('\n能压过 Hero 的牌型:');
for (const entry of analysis.byCategory) {
  if (entry.aheadCount === 0) continue;
  console.log(
    `  ${HAND_CATEGORY_LABELS[entry.category]}: ${entry.aheadCount} 组合 (${formatPercent(
      entry.aheadProbability,
    )})`,
  );
  for (const group of entry.groups) {
    console.log(
      `    ${group.label}: ${group.comboCount} 组合 (${formatPercent(group.probability)})`,
    );
  }
}

console.log('\n同牌型:');
const same = analysis.sameCategory;
console.log(`  ${HAND_CATEGORY_LABELS[same.category]} 总数 ${same.totalCount}`);
console.log(
  `  比你大 ${same.aheadCount} (${formatPercent(
    same.aheadConditionalProbability,
  )}) / 平手 ${same.tieCount} / 比你小 ${same.behindCount}`,
);
for (const group of same.aheadGroups) {
  console.log(`    ${group.label}: ${group.comboCount} 组合`);
}

const draws = analyzeDraws(scenario);
console.log('\n听牌:');
if (draws.hero.finished) {
  console.log('  河牌已发完，没有后续听牌。');
} else if (draws.hero.rows.length === 0) {
  console.log('  没有顺子 / 同花听牌。');
}
for (const row of draws.hero.rows) {
  console.log(
    `  ${row.label}: 补牌 ${row.completion.outs.length} 张, 下一张 ${row.completion.nextCount}/${row.completion.nextTotal}, 发完 ${row.completion.finalCount}/${row.completion.finalTotal}`,
  );
}
if (!draws.hero.finished && draws.hero.rows.length > 1) {
  console.log(
    `  并集: 下一张 ${draws.hero.union.nextCount}/${draws.hero.union.nextTotal}, 发完 ${draws.hero.union.finalCount}/${draws.hero.union.finalTotal}`,
  );
}
if (!draws.hero.finished) {
  console.log(
    `  对手: 有听牌 ${draws.opponent.drawingCombos} / ${draws.opponent.totalCombos}, 拿到且补成 ${formatPercent(draws.opponent.completeProbability)}`,
  );
}
