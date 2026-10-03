import type { HandCategory } from '../poker/evaluator';
import {
  HAND_CATEGORY_LABELS,
  TRAINABLE_HAND_CATEGORIES,
} from '../poker/evaluator';

interface HandTypeSelectorProps {
  value: HandCategory[];
  onChange: (next: HandCategory[]) => void;
  disabled?: boolean;
}

export function HandTypeSelector({
  value,
  onChange,
  disabled = false,
}: HandTypeSelectorProps) {
  const toggle = (category: HandCategory) => {
    if (disabled) return;
    if (value.includes(category)) {
      onChange(value.filter((item) => item !== category));
    } else {
      onChange([...value, category]);
    }
  };

  return (
    <div className="type-selector" role="group" aria-label="选择能压过你的牌型">
      {TRAINABLE_HAND_CATEGORIES.map((category) => {
        const selected = value.includes(category);
        return (
          <button
            key={category}
            type="button"
            className={`chip ${selected ? 'chip--selected' : ''}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => toggle(category)}
          >
            {HAND_CATEGORY_LABELS[category]}
          </button>
        );
      })}
    </div>
  );
}
