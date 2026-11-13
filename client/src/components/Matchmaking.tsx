import type { MatchmakingUiStatus, User } from "../types/game";
import { formatElo } from "../lib/format";
import { BackIcon, HomeIcon, NavIconButton } from "./Icons";

type Props = {
  user: User;
  status: MatchmakingUiStatus;
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
  opponentUsername,
  opponentRating,
  error,
  onCancel,
  onHome,
  onPlayLocal,
}: Props) {
  if (status === "found") {
    return (
      <section className="screen">
        <div className="nav-actions">
          <NavIconButton label="Home" onClick={onHome}>
            <HomeIcon />
          </NavIconButton>
        </div>
        <div className="panel center-panel">
          <span className="eyebrow">Opponent found</span>
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
          <div className="notice">Your five-card hand is being dealt.</div>
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
        <span className="eyebrow">Ranked matchmaking</span>
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
              Looking for a player at your level.
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
