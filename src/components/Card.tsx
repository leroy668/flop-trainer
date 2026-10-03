import type { Card as CardType } from '../poker/cards';
import { isRedSuit, SUIT_SYMBOLS } from '../poker/cards';

interface CardViewProps {
  card?: CardType;
  hidden?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function CardView({ card, hidden = false, size = 'md' }: CardViewProps) {
  if (hidden || !card) {
    return (
      <div className={`card card--${size} card--hidden`} aria-label="未知牌">
        ?
      </div>
    );
  }
  const color = isRedSuit(card.suit) ? 'card--red' : 'card--black';
  return (
    <div
      className={`card card--${size} ${color}`}
      aria-label={`${card.rank}${SUIT_SYMBOLS[card.suit]}`}
    >
      <span className="card__rank">{card.rank}</span>
      <span className="card__suit">{SUIT_SYMBOLS[card.suit]}</span>
    </div>
  );
}

/** 一排牌，用于展示具体花色组合。 */
export function CardPair({ cards }: { cards: readonly CardType[] }) {
  return (
    <span className="card-pair">
      {cards.map((card) => (
        <CardView key={`${card.rank}${card.suit}`} card={card} size="sm" />
      ))}
    </span>
  );
}
