/**
 * 手动检查脚本：
 *   npx vite-node scripts/inspect.ts
 * 打印 Fixture 场景的完整分析，便于人工核对。
 */
import { analyzeFlopScenario } from '../src/poker/analyzer';
import { HAND_CATEGORY_LABELS, describeHandValue } from '../src/poker/evaluator';
import { parseCards } from '../src/poker/cards';
import { formatPercent } from '../src/trainer/ranges';

const hero = parseCards('As Kd');
const flop = parseCards('Ah 8c 3d');
const analysis = analyzeFlopScenario({
  hero: [hero[0], hero[1]],
  flop: [flop[0], flop[1], flop[2]],
});

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
