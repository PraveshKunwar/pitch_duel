import type { GameMode, MatchmakingUiStatus, User } from "../types/game";
import { MODE_META } from "../game/modes";
import { formatElo } from "../lib/format";
import { BackIcon, HomeIcon, NavIconButton } from "./Icons";

type Props = {
  user: User;
  status: MatchmakingUiStatus;
  mode: GameMode | null;
  opponentUsername: string | null;
  opponentRating: number | null;
  error: string | null;
  onCancel: () => void;
  onHome: () => void;
  onPlayLocal: () => void;
};

export function Matchmaking({
  user,
  status,
  mode,
  opponentUsername,
  opponentRating,
  error,
  onCancel,
  onHome,
  onPlayLocal,
}: Props) {
  const modeTitle = mode ? MODE_META[mode].title : "Ranked";

  if (status === "found") {
    return (
      <section className="screen">
        <div className="nav-actions">
          <NavIconButton label="Home" onClick={onHome}>
            <HomeIcon />
          </NavIconButton>
        </div>
        <div className="panel center-panel">
          <span className="eyebrow">Opponent found · {modeTitle}</span>
          <h1>A new rivalry.</h1>
          <div className="result-stats">
            <div className="panel">
              <h3>{user.username}</h3>
              <small>{formatElo(user.rating)} ELO</small>
            </div>
            <div className="panel">
              <h3>{opponentUsername ?? "Opponent"}</h3>
              <small>{formatElo(opponentRating)} ELO</small>
            </div>
          </div>
          <p>Joining the match…</p>
          <div className="notice">
            {mode === "draft"
              ? "Draft lobby opening…"
              : mode === "tactical"
                ? "Lock your tactic next…"
                : "Hands are being dealt."}
          </div>
        </div>
      </section>
    );
  }

  const timedOut = status === "timeout";
  const cancelled = status === "cancelled";

  return (
    <section className="screen">
      <div className="nav-actions">
        <NavIconButton label="Home" onClick={onHome}>
          <HomeIcon />
        </NavIconButton>
        <NavIconButton label="Back to lobby" onClick={onCancel}>
          <BackIcon />
        </NavIconButton>
      </div>
      <div className="panel center-panel">
        <span className="eyebrow">Ranked · {modeTitle}</span>
        <div className="search-ring" aria-hidden="true">
          SCB
        </div>
        <h1>
          {timedOut
            ? "No rival found."
            : cancelled
              ? "Search cancelled."
              : "Finding your rival."}
        </h1>
        <p>
          {timedOut ? (
            "Nobody joined in time. Try again, or practice against the computer."
          ) : cancelled ? (
            "You’re out of the queue."
          ) : (
            <>
              Searching {modeTitle} only — other modes won’t match you.
              <br />
              Good matchups are worth the wait.
            </>
          )}
        </p>
        {!timedOut && !cancelled ? (
          <div className="queue-steps">
            <span className="active">01 · Queued</span>
            <span className="active">02 · Searching</span>
            <span>03 · Matched</span>
          </div>
        ) : null}
        <span className="pill">
          {user.username} · {formatElo(user.rating)} ELO
        </span>
        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}
        <div className="divider" />
        {timedOut || cancelled ? (
          <div className="lobby-actions" style={{ justifyContent: "center" }}>
            <button type="button" className="btn" onClick={onHome}>
              Return to lobby
            </button>
            <button type="button" className="btn secondary" onClick={onPlayLocal}>
              Play vs computer
            </button>
          </div>
        ) : (
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancel matchmaking
          </button>
        )}
      </div>
    </section>
  );
}
