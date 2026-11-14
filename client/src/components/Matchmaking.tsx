import type { GameMode, MatchmakingUiStatus, User } from "../types/game";
import { MODE_META } from "../game/modes";
import { formatElo } from "../lib/format";

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
  const timedOut = status === "timeout";
  const cancelled = status === "cancelled";
  const searching = status === "queued";
  const found = status === "found";

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={searching ? onHome : undefined}
    >
      <div
        className="panel modal queue-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="queue-title"
        onClick={(e) => e.stopPropagation()}
      >
        {found ? (
          <>
            <span className="eyebrow">Opponent found · {modeTitle}</span>
            <h2 id="queue-title">A new rivalry.</h2>
            <div className="result-stats" style={{ marginTop: 18 }}>
              <div className="panel">
                <h3>{user.username}</h3>
                <small>{formatElo(user.rating)} ELO</small>
              </div>
              <div className="panel">
                <h3>{opponentUsername ?? "Opponent"}</h3>
                <small>{formatElo(opponentRating)} ELO</small>
              </div>
            </div>
            <p style={{ marginTop: 16 }}>Joining the match…</p>
            <div className="notice">
              {mode === "draft"
                ? "Draft lobby opening…"
                : mode === "tactical"
                  ? "Lock your tactic next…"
                  : "Hands are being dealt."}
            </div>
          </>
        ) : (
          <>
            <span className="eyebrow">Ranked · {modeTitle}</span>
            <div className="search-ring" aria-hidden="true" style={{ margin: "18px auto" }}>
              SCB
            </div>
            <h2 id="queue-title">
              {timedOut
                ? "No rival found."
                : cancelled
                  ? "Search cancelled."
                  : "Finding your rival."}
            </h2>
            <p style={{ marginTop: 10 }}>
              {timedOut ? (
                "Nobody joined in time. Try again, or practice against the computer."
              ) : cancelled ? (
                "You’re out of the queue."
              ) : (
                <>
                  Searching {modeTitle} only — other modes won’t match you.
                  <br />
                  Leave the queue to return home.
                </>
              )}
            </p>
            {searching ? (
              <div className="queue-steps" style={{ marginTop: 18 }}>
                <span className="active">01 · Queued</span>
                <span className="active">02 · Searching</span>
                <span>03 · Matched</span>
              </div>
            ) : null}
            <span className="pill" style={{ marginTop: 16 }}>
              {user.username} · {formatElo(user.rating)} ELO
            </span>
            {error ? (
              <div className="alert" role="alert" style={{ marginTop: 14 }}>
                {error}
              </div>
            ) : null}
            <div className="divider" />
            {timedOut || cancelled ? (
              <div className="lobby-actions" style={{ justifyContent: "center" }}>
                <button type="button" className="btn" onClick={onHome}>
                  Return to lobby
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={onPlayLocal}
                >
                  Play vs computer
                </button>
              </div>
            ) : (
              <button type="button" className="btn secondary" onClick={onCancel}>
                Leave queue
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
