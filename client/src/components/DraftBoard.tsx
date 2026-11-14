import { useState } from "react";
import type { Card as CardType, DraftState, PlayerSeat } from "../types/game";
import { BackIcon, HomeIcon, NavIconButton } from "./Icons";
import { Card } from "./Card";

type Props = {
  draft: DraftState;
  yourSeat?: PlayerSeat;
  yourPicks?: CardType[];
  opponentPickCount?: number;
  onPick: (cardId: string) => void;
  onHome: () => void;
  onBack: () => void;
};

export function DraftBoard({
  draft,
  yourSeat = "player1",
  yourPicks,
  opponentPickCount,
  onPick,
  onHome,
  onBack,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const yourTurn = draft.nextPicker === yourSeat;
  const packLabel = `Pack ${draft.packIndex + 1} / ${draft.totalPacks}`;
  const mine =
    yourPicks ??
    (yourSeat === "player1" ? draft.player1Picks : draft.player2Picks);
  const theirs =
    opponentPickCount ??
    (yourSeat === "player1"
      ? draft.player2Picks.length
      : draft.player1Picks.length);

  return (
    <section className="screen">
      <div className="nav-actions">
        <NavIconButton label="Home" onClick={onHome}>
          <HomeIcon />
        </NavIconButton>
        <NavIconButton label="Exit draft" onClick={onBack}>
          <BackIcon />
        </NavIconButton>
      </div>

      <div className="row between">
        <div>
          <span className="eyebrow">Draft Battle · {packLabel}</span>
          <h2>Build your five.</h2>
        </div>
        <span className="pill">
          <span className={`dot ${yourTurn ? "" : "warn"}`} />
          {yourTurn ? "Your pick" : "Waiting for opponent…"}
        </span>
      </div>

      <div className="draft-status">
        <div>
          <small>Your squad</small>
          <h3>
            {mine.length} / {draft.handSize}
          </h3>
        </div>
        <div>
          <small>Opponent</small>
          <h3>
            {theirs} / {draft.handSize}
          </h3>
        </div>
      </div>

      <div className="panel draft-panel">
        <span className="eyebrow">Shared pack · leftover burns</span>
        <p className="muted" style={{ marginTop: 8 }}>
          {yourTurn
            ? "Take the star — or deny your opponent the answer."
            : "Opponent is choosing from this pack."}
        </p>
        <div className="draft-pack">
          {draft.currentPack.map((card) => (
            <Card
              key={card.ID}
              card={card}
              selected={selected === card.ID}
              disabled={!yourTurn}
              onSelect={(id) => setSelected(id)}
            />
          ))}
        </div>
        <button
          type="button"
          className={`btn lock ${selected && yourTurn ? "is-ready" : ""}`}
          disabled={!selected || !yourTurn}
          onClick={() => {
            if (!selected) return;
            const id = selected;
            setSelected(null);
            onPick(id);
          }}
        >
          Draft player
        </button>
      </div>

      {mine.length > 0 ? (
        <div className="draft-yours">
          <h3>Your picks</h3>
          <div className="draft-mini-hand">
            {mine.map((card) => (
              <Card key={card.ID} card={card} selectable={false} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
