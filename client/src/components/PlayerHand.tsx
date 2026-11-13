import type { Card as CardType, StatCategory } from "../types/game";
import { Card } from "./Card";

type Props = {
  cards: CardType[];
  selectedCardId: string | null;
  locked: boolean;
  disabled: boolean;
  category: StatCategory | null;
  onSelect: (cardId: string) => void;
  onSubmit: () => void;
};

export function PlayerHand({
  cards,
  selectedCardId,
  locked,
  disabled,
  category,
  onSelect,
  onSubmit,
}: Props) {
  const ready = Boolean(selectedCardId) && !locked && !disabled;

  return (
    <>
      <div className="hand-top">
        <h3>
          Your hand <small>· {cards.length} remaining</small>
        </h3>
        <small>{locked ? "Pick locked" : "Choose one card"}</small>
      </div>
      <div className="hand">
        {cards.map((card) => (
          <Card
            key={card.ID}
            card={card}
            selected={selectedCardId === card.ID}
            disabled={disabled || locked}
            highlightCategory={category}
            onSelect={onSelect}
          />
        ))}
      </div>
      <div className="actions">
        <div
          className={`selection-note ${ready || locked ? "is-ready" : ""}`}
          aria-live="polite"
        >
          {locked
            ? "Card locked in · waiting for opponent"
            : ready
              ? "Card selected · ready to lock in"
              : "Select a card to continue"}
        </div>
        <button
          type="button"
          className={`btn ${ready ? "is-ready" : "lock"}`}
          disabled={!ready}
          onClick={onSubmit}
        >
          {locked ? "Locked in…" : "Lock in card"}
        </button>
      </div>
    </>
  );
}
