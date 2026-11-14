import type { GameState, RoundResult, StatCategory } from "./types";

export const ROUNDS_PER_MATCH = 5;

type Seat = Exclude<RoundResult["winner"], null>;

export interface MatchRoundSummary {
  roundNo: number;
  stat: StatCategory;
  card1Id: string;
  card2Id: string;
  winner: Seat;
}

export interface MatchSummary {
  winner: Seat;
  score: Record<Seat, number>;
  rounds: MatchRoundSummary[];
}

export function summarizeMatch(state: GameState): MatchSummary {
  if (state.status !== "finished") {
    throw new Error("Cannot summarize a match that is not finished");
  }
  if (state.history.length < 1) {
    throw new Error("A finished match must have at least one round");
  }
  if (state.player1.score === state.player2.score) {
    throw new Error("A finished match must have a winner");
  }

  // match_rounds.winner_id is NOT NULL — omit draw rounds from persistence.
  const rounds: MatchRoundSummary[] = [];
  for (const round of state.history) {
    if (round.result.winner === null) continue;
    rounds.push({
      roundNo: round.round,
      stat: round.category,
      card1Id: round.card1.ID,
      card2Id: round.card2.ID,
      winner: round.result.winner,
    });
  }
  if (rounds.length < 1) {
    throw new Error("A finished match must have at least one decisive round");
  }

  return {
    winner: state.player1.score > state.player2.score ? "player1" : "player2",
    score: { player1: state.player1.score, player2: state.player2.score },
    rounds,
  };
}
