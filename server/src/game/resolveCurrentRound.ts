import { CompletedRound, GameState, StatCategory } from "./types";
import { resolveRound } from "./resolveRound";

export function resolveCurrentRound(
  state: GameState,
  nextCategory: StatCategory,
  random: () => number = Math.random,
): GameState {
  if (state.status === "finished") {
    throw new Error("Cannot resolve a round: the game is finished");
  }
  if (
    state.player1.selectedCardId === null ||
    state.player2.selectedCardId === null
  ) {
    throw new Error("Both players must selected a card before resolving");
  }
  const card1 = state.player1.hand.find(
    (card) => card.ID === state.player1.selectedCardId,
  );
  const card2 = state.player2.hand.find(
    (card) => card.ID === state.player2.selectedCardId,
  );
  if (!card1 || !card2) {
    throw new Error("A selected card was not found in a players hand");
  }
  const result = resolveRound(card1, card2, state.category, random);
  const completedRound: CompletedRound = {
    round: state.round,
    category: state.category,
    card1,
    card2,
    result,
  };
  const player1Score =
    state.player1.score + (result.winner === "player1" ? 1 : 0);
  const player2Score =
    state.player2.score + (result.winner === "player2" ? 1 : 0);
  const player1RemainingHand = state.player1.hand.filter(
    (card) => card.ID !== card1.ID,
  );
  const player2RemainingHand = state.player2.hand.filter(
    (card) => card.ID !== card2.ID,
  );
  const finished = state.round === 5;

  return {
    ...state,
    player1: {
      ...state.player1,
      score: player1Score,
      hand: player1RemainingHand,
      selectedCardId: null,
    },
    player2: {
      ...state.player2,
      score: player2Score,
      hand: player2RemainingHand,
      selectedCardId: null,
    },
    history: [...state.history, completedRound],
    status: finished ? "finished" : "picking",
    round: finished ? 5 : state.round + 1,
    category: finished ? state.category : nextCategory,
  };
}
