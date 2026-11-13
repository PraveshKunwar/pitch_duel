import type { User } from "../types/game";
import { formatElo } from "../lib/format";

type Props = {
  user: User | null;
  active: "lobby" | "game" | "leaderboard" | "auth" | "matchmaking";
  onHome: () => void;
  onLobby: () => void;
  onPlay: () => void;
  onLeaderboard: () => void;
  onLogout?: () => void;
};

export function TopBar({
  user,
  active,
  onHome,
  onLobby,
  onPlay,
  onLeaderboard,
  onLogout,
}: Props) {
  return (
    <header className="topbar">
      <div className="shell bar">
        <button type="button" className="brand" onClick={onHome}>
          SC<span>B</span> / SOCCER CARD BATTLE
        </button>
        {user ? (
          <>
            <nav className="nav" aria-label="Main navigation">
              <button
                type="button"
                className={
                  active === "lobby" || active === "matchmaking"
                    ? "is-active"
                    : undefined
                }
                onClick={onLobby}
              >
                Lobby
              </button>
              <button
                type="button"
                className={active === "game" ? "is-active" : undefined}
                onClick={onPlay}
              >
                Play
              </button>
              <button
                type="button"
                className={active === "leaderboard" ? "is-active" : undefined}
                onClick={onLeaderboard}
              >
                Leaderboard
              </button>
            </nav>
            <div className="profile">
              {user.username}{" "}
              <strong>{formatElo(user.rating)} ELO</strong>
            </div>
            {onLogout ? (
              <button type="button" className="subtle-link" onClick={onLogout}>
                Sign out
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </header>
  );
}
