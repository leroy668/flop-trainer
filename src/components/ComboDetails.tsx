import { useState } from 'react';
import type { RankGroupAnalysis } from '../poker/analyzer';
import { sortCardsDesc } from '../poker/grouping';
import { CardPair } from './Card';
import { CountBadge, Pct } from './ProbabilityText';

interface ComboDetailsProps {
  groups: RankGroupAnalysis[];
  /** 若提供，则额外显示 comboCount / denominator 的条件概率。 */
  conditionalDenominator?: number;
  emptyText?: string;
}

/**
 * 类型列表，每个类型可以展开查看具体花色组合。
 * 行名已经包含了全部成员（例如「配对公共牌 K / 9 / 6」「8 / 7高同花」），
 * 同一行内的成员概率相同，所以不再需要额外的二级小标题。
 */
export function ComboDetails({
  groups,
  conditionalDenominator,
  emptyText = '没有符合条件的组合',
}: ComboDetailsProps) {
  const [openLabels, setOpenLabels] = useState<string[]>([]);

  if (groups.length === 0) {
    return <p className="muted">{emptyText}</p>;
  }

  const toggle = (label: string) => {
    setOpenLabels((current) =>
      current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label],
    );
  };

  return (
    <ul className="rank-groups">
      {groups.map((group) => {
        const open = openLabels.includes(group.label);
        // 同一行内每个成员的组合数相同：总数 ÷ 成员个数。
        const perMemberCount = group.comboCount / group.memberCount;
        const perMemberProbability = group.probability / group.memberCount;
        const merged = group.memberCount > 1;
        return (
          <li className="rank-group" key={group.label}>
            <button
              type="button"
              className="rank-group__header"
              aria-expanded={open}
              onClick={() => toggle(group.label)}
            >
              <span className="rank-group__label">{group.label}</span>
              <span className="rank-group__meta">
                <CountBadge count={group.comboCount} />
                <span className="rank-group__prob">
                  {merged ? '合计' : ''}占全部{' '}
                  <Pct value={group.probability} tone="danger" />
                </span>
                {conditionalDenominator && conditionalDenominator > 0 ? (
                  <span className="rank-group__prob">
                    {merged ? '合计' : ''}占同牌型{' '}
                    <Pct
                      value={group.comboCount / conditionalDenominator}
                      tone="neutral"
                    />
                  </span>
                ) : null}
              </span>
              <span className="rank-group__arrow">{open ? '收起' : '展开花色'}</span>
            </button>
            {merged ? (
              <p className="rank-group__per">
                <span className="rank-group__per-tag">行内每种</span>
                <span className="rank-group__per-item">
                  <span className="rank-group__per-key">单个组合数</span>
                  <CountBadge count={perMemberCount} />
                </span>
                <span className="rank-group__per-item rank-group__per-item--prob">
                  <span className="rank-group__per-key">单个占全部</span>
                  <Pct value={perMemberProbability} tone="info" />
                </span>
                {conditionalDenominator && conditionalDenominator > 0 ? (
                  <span className="rank-group__per-item rank-group__per-item--same">
                    <span className="rank-group__per-key">单个占同牌型</span>
                    <Pct
                      value={perMemberCount / conditionalDenominator}
                      tone="neutral"
                    />
                  </span>
                ) : null}
              </p>
            ) : null}
            {open && (
              <div className="rank-group__combos">
                {group.combos.map((combo) => {
                  const sorted = sortCardsDesc(combo);
                  return (
                    <div
                      className="combo-row"
                      key={combo.map((c) => `${c.rank}${c.suit}`).join('-')}
                    >
                      <CardPair cards={sorted} />
                    </div>
                  );
                })}
              </div>
            )}
            </li>
        );
      })}
    </ul>
  );
}
