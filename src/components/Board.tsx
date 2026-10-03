import type { FlopScenario } from '../poker/cards';
import { CardView } from './Card';

export function Board({ scenario }: { scenario: FlopScenario }) {
  return (
    <div className="board">
      <div className="board__group">
        <span className="board__label">你的手牌</span>
        <div className="board__cards">
          {scenario.hero.map((card) => (
            <CardView key={`${card.rank}${card.suit}`} card={card} size="lg" />
          ))}
        </div>
      </div>
      <div className="board__group">
        <span className="board__label">翻牌</span>
        <div className="board__cards">
          {scenario.flop.map((card) => (
            <CardView key={`${card.rank}${card.suit}`} card={card} size="lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
