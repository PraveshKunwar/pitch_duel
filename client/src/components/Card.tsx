import type { Card as CardType, StatCategory } from "../types/game";
import { initials, overallRating, positionRole } from "../lib/format";

type Props = {
  card: CardType;
  selected?: boolean;
  disabled?: boolean;
  highlightCategory?: StatCategory | null;
  onSelect?: (cardId: string) => void;
  selectable?: boolean;
};

export function Card({
  card,
  selected,
  disabled,
  highlightCategory,
  onSelect,
  selectable = true,
}: Props) {
  const body = (
    <article className="card">
      <div className="rating">{overallRating(card)}</div>
      <div className="position">{card.position}</div>
      <div className="card-art" aria-hidden="true">
        <span>{initials(card.name)}</span>
      </div>
      <h3>{card.name}</h3>
      <p className="role">{positionRole(card.position)}</p>
      <div className="stats">
        <span className={highlightCategory === "attack" ? "active" : undefined}>
          ATK<b>{card.attack}</b>
        </span>
        <span
          className={highlightCategory === "defending" ? "active" : undefined}
        >
          DEF<b>{card.defending}</b>
        </span>
        <span
          className={highlightCategory === "passing" ? "active" : undefined}
        >
          PAS<b>{card.passing}</b>
        </span>
      </div>
    </article>
  );

  if (!selectable) return body;

  return (
    <button
      type="button"
      className={`choice ${selected ? "is-selected" : ""}`}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`Select ${card.name}`}
      onClick={() => onSelect?.(card.ID)}
    >
      {body}
    </button>
  );
}
