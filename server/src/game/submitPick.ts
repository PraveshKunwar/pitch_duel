import { GameState } from "./types";

export function submitPick(
  state: GameState,
  player: "player1" | "player2",
  cardId: string,
): GameState {
  if (state.status === "finished") {
    throw new Error("Cannot submit a pick: the game is finished");
  }
  const playersState = state[player];
  if (playersState.selectedCardId !== null) {
    throw new Error("Player has already selected a card");
  }
  const card = state[player].hand.find((card) => card.ID === cardId);
  if (!card) {
    throw new Error("Card isn't in this players hand");
  }
  return {
    ...state,
    [player]: {
      ...playersState,
      selectedCardId: cardId,
    },
  };
}
