import type { Card as CardType, Scenario, Street } from '../poker/cards';
import { CardView } from './Card';

function EmptySlot() {
  return <span className="card card--lg card--empty" aria-label="未发牌" />;
}

function BoardGroup({
  label,
  cards,
  highlight = false,
}: {
  label: string;
  cards: (CardType | undefined)[];
  highlight?: boolean;
}) {
  return (
    <div className={`board__group ${highlight ? 'board__group--new' : ''}`}>
      <span className="board__label">{label}</span>
      <div className="board__cards">
        {cards.map((card, index) =>
          card ? (
            <CardView key={`${card.rank}${card.suit}`} card={card} size="lg" />
          ) : (
            <EmptySlot key={`empty-${label}-${index}`} />
          ),
        )}
      </div>
    </div>
  );
}

/**
 * 牌面：Hero 手牌 + 翻牌 + 转牌 + 河牌。
 * 还没发的公共牌显示为空位，方便看清现在处于哪条街。
 * `highlightStreet` 是刚刚发下来的那条街（收回后会传 null）。
 */
export function Board({
  scenario,
  highlightStreet = null,
}: {
  scenario: Scenario;
  highlightStreet?: Street | null;
}) {
  return (
    <div className="board">
      <BoardGroup label="你的手牌" cards={[...scenario.hero]} />
      <BoardGroup label="翻牌" cards={[...scenario.flop]} />
      <BoardGroup
        label="转牌"
        cards={[scenario.turn]}
        highlight={highlightStreet === 'turn'}
      />
      <BoardGroup
        label="河牌"
        cards={[scenario.river]}
        highlight={highlightStreet === 'river'}
      />
    </div>
  );
}
