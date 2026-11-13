import type { CompletedRound, PlayerSeat, StatCategory } from "../types/game";
import { categoryShort } from "../lib/format";

type Props = {
  history: CompletedRound[];
  yourSeat: PlayerSeat | null;
  currentRound: number;
  currentCategory: StatCategory | null;
  ended: boolean;
  /** Planned regulation rounds (3 or 5). Extra SD rounds append beyond this. */
  regulationRounds?: number;
  suddenDeath?: boolean;
};

function cardStat(
  card: { attack: number; defending: number; passing: number },
  category: StatCategory,
): number {
  if (category === "attack") return card.attack;
  if (category === "defending") return card.defending;
  return card.passing;
}

export function RoundHistory({
  history,
  yourSeat,
  currentRound,
  currentCategory,
  ended,
  regulationRounds = 5,
  suddenDeath = false,
}: Props) {
  const maxRound = Math.max(
    regulationRounds,
    currentRound,
    ...history.map((h) => h.round),
  );

  const rows = Array.from({ length: maxRound }, (_, i) => {
    const round = i + 1;
    const done = history.find((r) => r.round === round);
    const sd = round > regulationRounds;
    if (done && yourSeat) {
      const draw = done.result.winner === null;
      const won = done.result.winner === yourSeat;
      const yours = yourSeat === "player1" ? done.card1 : done.card2;
      const theirs = yourSeat === "player1" ? done.card2 : done.card1;
      const y = cardStat(yours, done.category);
      const o = cardStat(theirs, done.category);
      return {
        round,
        className: "",
        label: `${sd ? "SUDDEN DEATH" : `ROUND ${String(round).padStart(2, "0")}`} · ${categoryShort(done.category)}`,
        result: draw ? (
          <b className="muted">
            Draw · {y} : {o}
          </b>
        ) : (
          <b className={won ? "win" : "loss"}>
            {won ? "You won" : "You lost"} · {y} : {o}
          </b>
        ),
      };
    }
    if (!ended && round === currentRound) {
      return {
        round,
        className: "current",
        label: `${
          sd || suddenDeath
            ? "SUDDEN DEATH"
            : `ROUND ${String(round).padStart(2, "0")}`
        }${currentCategory ? ` · ${categoryShort(currentCategory)}` : ""}`,
        result: <b>In progress</b>,
      };
    }
    return {
      round,
      className: "",
      label: sd
        ? "SUDDEN DEATH"
        : `ROUND ${String(round).padStart(2, "0")}`,
      result: <b className="muted">Not played</b>,
    };
  });

  return (
    <div className="history">
      <div className="row between">
        <h3>Match timeline</h3>
        <small>
          {suddenDeath
            ? "Sudden death — first win takes it"
            : `Best score after ${regulationRounds} rounds`}
        </small>
      </div>
      <div className="rounds">
        {rows.map((row) => (
          <div key={row.round} className={`round ${row.className}`}>
            <small>{row.label}</small>
            {row.result}
          </div>
        ))}
      </div>
    </div>
  );
}
