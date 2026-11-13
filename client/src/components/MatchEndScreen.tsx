import type { CompletedRound, GameMode, PlayerSeat } from "../types/game";
import { MODE_META } from "../game/modes";
import { formatElo } from "../lib/format";
import { BackIcon, HomeIcon, NavIconButton } from "./Icons";
import { RoundHistory } from "./RoundHistory";

type Props = {
  outcome: "win" | "loss" | "abandoned";
  mode: "ranked" | "local";
  gameMode?: GameMode;
  youName: string;
  oppName: string;
  youScore: number;
  oppScore: number;
  youRating: number | null;
  oppRating: number | null;
  history: CompletedRound[];
  yourSeat: PlayerSeat;
  reason?: "completed" | "forfeit" | "abandoned" | null;
  onHome: () => void;
  onLobby: () => void;
};

export function MatchEndScreen({
  outcome,
  mode,
  gameMode = "classic",
  youName,
  oppName,
  youScore,
  oppScore,
  youRating,
  oppRating,
  history,
  yourSeat,
  reason,
  onHome,
  onLobby,
}: Props) {
  const title =
    outcome === "abandoned"
      ? "Match abandoned."
      : outcome === "win"
        ? reason === "forfeit"
          ? "You win by forfeit."
          : "Victory is yours."
        : reason === "forfeit"
          ? "You forfeited."
          : "Defeat this time.";

  const subtitle =
    outcome === "abandoned"
      ? "Both players left the pitch."
      : mode === "local"
        ? outcome === "win"
          ? `You beat the computer ${youScore}–${oppScore}.`
          : `Computer takes it ${oppScore}–${youScore}.`
        : outcome === "win"
          ? `${youName} wins the match.`
          : `${oppName} takes the match.`;

  const modeLabel =
    mode === "local" ? MODE_META[gameMode].title : "Ranked match";
  const regulation = MODE_META[gameMode].rounds;

  return (
    <section className={`screen end-screen end-screen--${outcome}`}>
      <div className="nav-actions">
        <NavIconButton label="Home" onClick={onHome}>
          <HomeIcon />
        </NavIconButton>
        <NavIconButton label="Back to lobby" onClick={onLobby}>
          <BackIcon />
        </NavIconButton>
      </div>

      <div className="panel center-panel end-panel">
        <span className="eyebrow">
          Full time · {modeLabel}
        </span>
        <div
          className={`search-ring ${outcome === "win" ? "ring-win" : outcome === "loss" ? "ring-loss" : ""}`}
          aria-hidden="true"
        >
          {outcome === "abandoned" ? "—" : outcome === "win" ? "W" : "L"}
        </div>
        <h1 className={outcome === "win" ? "win" : outcome === "loss" ? "loss" : undefined}>
          {title}
        </h1>
        <p>{subtitle}</p>
        <div className="big-number" style={{ margin: "24px 0" }}>
          {youScore} <span className="muted">:</span> {oppScore}
        </div>
        <div className="result-stats">
          <div className="panel">
            <small>
              {youName}
              {outcome === "win" ? " · Winner" : ""}
            </small>
            <h2>
              {mode === "local"
                ? "Practice"
                : formatElo(youRating)}
            </h2>
          </div>
          <div className="panel">
            <small>
              {oppName}
              {outcome === "loss" ? " · Winner" : ""}
            </small>
            <h2>
              {mode === "local"
                ? "CPU"
                : formatElo(oppRating)}
            </h2>
          </div>
        </div>
        <RoundHistory
          history={history}
          yourSeat={yourSeat}
          currentRound={Math.max(regulation, history.length)}
          currentCategory={null}
          ended
          regulationRounds={regulation}
        />
        <div className="divider" />
        <button type="button" className="btn" onClick={onLobby}>
          Return to lobby
        </button>
      </div>
    </section>
  );
}
