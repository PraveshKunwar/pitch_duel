import { useState } from "react";
import type { Tactic } from "../types/game";
import { TACTIC_META } from "../game/modes";
import { BackIcon, HomeIcon, NavIconButton } from "./Icons";

type Props = {
  onConfirm: (tactic: Tactic) => void;
  onBack: () => void;
  onHome: () => void;
};

const ORDER: Tactic[] = [
  "attacking",
  "defensive",
  "possession",
  "balanced",
];

export function TacticSelect({ onConfirm, onBack, onHome }: Props) {
  const [selected, setSelected] = useState<Tactic | null>(null);

  return (
    <section className="screen">
      <div className="nav-actions">
        <NavIconButton label="Home" onClick={onHome}>
          <HomeIcon />
        </NavIconButton>
        <NavIconButton label="Back" onClick={onBack}>
          <BackIcon />
        </NavIconButton>
      </div>

      <div className="heading">
        <span className="eyebrow">Tactical Battle</span>
        <h1>Lock your approach.</h1>
        <p>
          Choose in secret. The computer locks one too — revealed after you
          commit.
        </p>
      </div>

      <div className="tactic-grid">
        {ORDER.map((tactic) => {
          const meta = TACTIC_META[tactic];
          const active = selected === tactic;
          return (
            <button
              key={tactic}
              type="button"
              className={`tactic-card ${active ? "is-selected" : ""}`}
              onClick={() => setSelected(tactic)}
              aria-pressed={active}
            >
              <h2>{meta.title}</h2>
              <p>{meta.description}</p>
            </button>
          );
        })}
      </div>

      <div className="lobby-actions" style={{ marginTop: 28 }}>
        <button
          type="button"
          className={`btn lock ${selected ? "is-ready" : ""}`}
          disabled={!selected}
          onClick={() => selected && onConfirm(selected)}
        >
          Kick off
        </button>
      </div>
    </section>
  );
}
