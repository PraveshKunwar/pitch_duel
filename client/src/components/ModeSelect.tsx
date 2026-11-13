import type { GameMode } from "../types/game";
import { MODE_META } from "../game/modes";
import { BackIcon, HomeIcon, NavIconButton } from "./Icons";

type Props = {
  onSelect: (mode: GameMode) => void;
  onBack: () => void;
  onHome: () => void;
};

const ORDER: GameMode[] = ["classic", "draft", "sudden_death", "tactical"];

export function ModeSelect({ onSelect, onBack, onHome }: Props) {
  return (
    <section className="screen">
      <div className="nav-actions">
        <NavIconButton label="Home" onClick={onHome}>
          <HomeIcon />
        </NavIconButton>
        <NavIconButton label="Back to lobby" onClick={onBack}>
          <BackIcon />
        </NavIconButton>
      </div>

      <div className="heading">
        <span className="eyebrow">Local practice</span>
        <h1>Pick your rules.</h1>
        <p>Four ways to duel the computer. Ranked stays classic.</p>
      </div>

      <div className="mode-grid">
        {ORDER.map((mode) => {
          const meta = MODE_META[mode];
          return (
            <button
              key={mode}
              type="button"
              className="mode-card"
              onClick={() => onSelect(mode)}
            >
              <span className="eyebrow">{meta.rounds} rounds · {meta.handSize} cards</span>
              <h2>{meta.title}</h2>
              <p>{meta.tagline}</p>
              <small className="mode-twist">{meta.twist}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
