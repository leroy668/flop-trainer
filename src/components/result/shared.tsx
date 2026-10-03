import { getProbabilityRangeById } from '../../trainer/ranges';

/** 概率区间 id -> 中文标签（未作答时给出明确提示）。 */
export function rangeLabel(id?: string): string {
  if (!id) return '未作答';
  return getProbabilityRangeById(id)?.label ?? id;
}

/** 作答对错标记。 */
export function Verdict({ correct }: { correct: boolean }) {
  return (
    <span className={`verdict ${correct ? 'verdict--ok' : 'verdict--bad'}`}>
      {correct ? '✓ 正确' : '✗ 错误'}
    </span>
  );
}
