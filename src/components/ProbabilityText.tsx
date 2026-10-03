import { formatPercent } from '../trainer/ranges';

export type PctTone = 'danger' | 'tie' | 'safe' | 'neutral' | 'info';

interface PctProps {
  value: number;
  tone?: PctTone;
  size?: 'md' | 'lg';
  title?: string;
}

/** 醒目的百分比数字。 */
export function Pct({ value, tone = 'neutral', size = 'md', title }: PctProps) {
  return (
    <span className={`pct pct--${tone} pct--${size}`} title={title}>
      {formatPercent(value)}
    </span>
  );
}

/** 组合数量徽标。 */
export function CountBadge({ count, unit = '个组合' }: { count: number; unit?: string }) {
  return (
    <span className="count-badge">
      {count} {unit}
    </span>
  );
}
