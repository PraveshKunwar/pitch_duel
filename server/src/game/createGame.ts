import { dealHand } from "./dealHand";
import { Card, GameState, StatCategory } from "./types";

export function createGame(
  player1Deck: Card[],
  player2Deck: Card[],
  firstCategory: StatCategory,
): GameState {
  const player1Hand = dealHand(player1Deck);
  const player2Hand = dealHand(player2Deck);

  return {
    round: 1,
    category: firstCategory,
    status: "picking",
    player1: {
      hand: player1Hand,
      selectedCardId: null,
      score: 0,
    },
    player2: {
      hand: player2Hand,
      selectedCardId: null,
      score: 0,
    },
    history: [],
  };
}
