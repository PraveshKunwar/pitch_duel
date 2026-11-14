import type { ConnectionUiState, User } from "../types/game";
import { formatElo } from "../lib/format";

type Props = {
  user: User;
  connection: ConnectionUiState;
  error: string | null;
  onFindMatch: () => void;
  onPlayLocal: () => void;
  onLeaderboard: () => void;
};

function connectionPill(connection: ConnectionUiState): {
  label: string;
  tone: "ok" | "warn" | "bad";
} {
  switch (connection) {
    case "connecting":
      return { label: "Connecting…", tone: "warn" };
    case "reconnecting":
      return { label: "Reconnecting…", tone: "warn" };
    case "connected":
    case "match_resumed":
      return { label: "Connected", tone: "ok" };
    case "opponent_disconnected":
      return { label: "Opponent reconnecting…", tone: "warn" };
    default:
      return { label: "Ready", tone: "ok" };
  }
}

export function Lobby({
  user,
  connection,
  error,
  onFindMatch,
  onPlayLocal,
  onLeaderboard,
}: Props) {
  const status = connectionPill(connection);

  return (
    <section className="screen">
      <div className="heading">
        <span className="eyebrow">The players’ lounge</span>
        <h1>Ready when you are.</h1>
        <p>Welcome back, {user.username}. Make every card count.</p>
      </div>

      <div className="lobby-layout">
        <div className="panel play-panel">
          <span className="pill">
            <span
              className={`dot ${status.tone === "warn" ? "warn" : status.tone === "bad" ? "bad" : ""}`}
            />
            RANKED · 1V1 · {status.label}
          </span>
          <h1>
            A better hand.
            <br />
            A smarter play.
          </h1>
          <p>
            Five players. Three stats. Choose the right card for each round and
            take the match.
          </p>
          <div className="lobby-actions">
            <button type="button" className="btn" onClick={onFindMatch}>
              Find match
            </button>
            <button type="button" className="btn secondary" onClick={onPlayLocal}>
              Play vs computer
            </button>
          </div>
          <div className="divider" />
          <small>
            Pick a mode for ranked or local — queues never cross modes
          </small>
          {error ? (
            <div className="alert" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <aside className="stack">
          <div className="panel">
            <span className="eyebrow">Your player profile</span>
            <h2>{user.username}</h2>
            <div className="divider" />
            <small>Current rating</small>
            <div className="big-number elo">
              {formatElo(user.rating)}{" "}
              <small style={{ fontSize: 14 }}>ELO</small>
            </div>
            <p className="muted">Build your legacy, one match at a time.</p>
          </div>
          <div className="panel">
            <h3>Climb the leaderboard</h3>
            <p className="muted">See who’s setting the standard.</p>
            <button
              type="button"
              className="btn secondary"
              style={{ marginTop: 18 }}
              onClick={onLeaderboard}
            >
              View rankings
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
