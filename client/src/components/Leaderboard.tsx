import { useEffect, useState } from "react";
import { api } from "../services/api";
import type { LeaderboardEntry, User } from "../types/game";
import { formatElo } from "../lib/format";
import { BackIcon, HomeIcon, NavIconButton } from "./Icons";

type Props = {
  user: User | null;
  onBack: () => void;
  onHome: () => void;
};

export function Leaderboard({ user, onBack, onHome }: Props) {
  const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.leaderboard(20);
        if (!cancelled) {
          setPlayers(data.players);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        <span className="eyebrow">The best in the battle</span>
        <h1>Leaderboard.</h1>
        <p>Every great run starts with one smart play.</p>
      </div>

      <div className="leader-meta">
        <span className="pill">RANKED · ALL PLAYERS</span>
      </div>

      {loading ? <div className="notice">Loading rankings…</div> : null}
      {error ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="panel table-wrap">
          <table>
            <caption>Top players</caption>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Player</th>
                <th scope="col">Elo rating</th>
              </tr>
            </thead>
            <tbody>
              {players.length === 0 ? (
                <tr>
                  <td colSpan={3}>No ranked players yet.</td>
                </tr>
              ) : (
                players.map((p) => {
                  const isYou = user && String(user.id) === String(p.userId);
                  return (
                    <tr key={p.userId} className={isYou ? "you" : undefined}>
                      <td className={`rank ${p.rank <= 3 ? "top-rank" : ""}`}>
                        {String(p.rank).padStart(2, "0")}
                      </td>
                      <td>
                        {p.username ?? "Unknown"}
                        {isYou ? (
                          <>
                            {" "}
                            <span className="pill">YOU</span>
                          </>
                        ) : null}
                      </td>
                      <td>
                        <strong>{formatElo(p.rating)}</strong>{" "}
                        <small>ELO</small>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
