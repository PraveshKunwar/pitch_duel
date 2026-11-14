import { useState } from "react";
import type { Tactic } from "../types/game";
import { TACTIC_META } from "../game/modes";
import { BackIcon, HomeIcon, NavIconButton } from "./Icons";

type Props = {
  locked?: Tactic | null;
  opponentReady?: boolean;
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

export function TacticSelect({
  locked = null,
  opponentReady = false,
  onConfirm,
  onBack,
  onHome,
}: Props) {
  const [selected, setSelected] = useState<Tactic | null>(locked);

  if (locked) {
    return (
      <section className="screen">
        <div className="nav-actions">
          <NavIconButton label="Home" onClick={onHome}>
            <HomeIcon />
          </NavIconButton>
        </div>
        <div className="panel center-panel">
          <span className="eyebrow">Tactical Battle</span>
          <h1>Tactic locked.</h1>
          <p>
            You chose {TACTIC_META[locked].title}.{" "}
            {opponentReady
              ? "Opponent is ready — kickoff imminent."
              : "Waiting for your opponent to lock in."}
          </p>
        </div>
      </section>
    );
  }

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
          Choose in secret. Both tactics reveal when the match starts.
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
