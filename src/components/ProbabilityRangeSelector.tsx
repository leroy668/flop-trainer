import { PROBABILITY_RANGES } from '../trainer/ranges';

interface ProbabilityRangeSelectorProps {
  name: string;
  value?: string;
  onChange: (rangeId: string) => void;
  disabled?: boolean;
}

export function ProbabilityRangeSelector({
  name,
  value,
  onChange,
  disabled = false,
}: ProbabilityRangeSelectorProps) {
  return (
    <div className="range-selector" role="radiogroup" aria-label={name}>
      {PROBABILITY_RANGES.map((range) => {
        const selected = value === range.id;
        return (
          <button
            key={range.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`chip ${selected ? 'chip--selected' : ''}`}
            disabled={disabled}
            onClick={() => onChange(range.id)}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  );
}
