import type { Card as CardType, Suit } from '../poker/cards';
import { isRedSuit } from '../poker/cards';

interface CardViewProps {
  card?: CardType;
  hidden?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

function SuitIcon({ suit, className }: { suit: Suit; className?: string }) {
  switch (suit) {
    case 's': // 黑桃 Spades
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 2C10.5 4.8 5 11 5 15c0 2.8 2.2 4.5 4.8 4.5 1.5 0 2.5-.7 3.2-1.6.7.9 1.7 1.6 3.2 1.6 2.6 0 4.8-1.7 4.8-4.5 0-4-5.5-10.2-7-13zm-1 16.5v3.5H9v1h6v-1h-2v-3.5c-.5.4-1.2.5-2 .5z" />
        </svg>
      );
    case 'h': // 红心 Hearts
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      );
    case 'd': // 方块 Diamonds
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 2L4 12l8 10 8-10z" />
        </svg>
      );
    case 'c': // 草花 Clubs
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 3.5c-2 0-3.5 1.5-3.5 3.3 0 1.2.7 2.3 1.7 2.8-1.5-.4-3.2.4-3.9 1.8-.8 1.4-.4 3.2.9 4.1 1.2.9 2.9.7 3.9-.4v1.4H9.5v1.5h5v-1.5h-1.6v-1.4c1 1.1 2.7 1.3 3.9.4 1.3-.9 1.7-2.7.9-4.1-.7-1.4-2.4-2.2-3.9-1.8 1-.5 1.7-1.6 1.7-2.8 0-1.8-1.5-3.3-3.5-3.3z" />
        </svg>
      );
  }
}

export function CardView({ card, hidden = false, size = 'md' }: CardViewProps) {
  if (hidden || !card) {
    return (
      <div className={`card card--${size} card--hidden`} aria-label="未知牌">
        <span className="card__back-mark">🂠</span>
      </div>
    );
  }
  const color = isRedSuit(card.suit) ? 'card--red' : 'card--black';
  return (
    <div
      className={`card card--${size} ${color}`}
      aria-label={`${card.rank} ${card.suit}`}
    >
      <span className="card__rank">{card.rank}</span>
      <span className="card__suit-icon-wrap">
        <SuitIcon suit={card.suit} className="card__suit-svg" />
      </span>
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
