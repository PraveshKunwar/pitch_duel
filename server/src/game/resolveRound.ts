import { Card, RoundResult, StatCategory } from "./types";

export function resolveRound(
  card1: Card,
  card2: Card,
  category: StatCategory,
  random: () => number = Math.random,
): RoundResult {
  if (card1[category] < card2[category]) {
    return { winner: "player2", decidedBy: "category" };
  }
  if (card1[category] > card2[category]) {
    return { winner: "player1", decidedBy: "category" };
  }

  const player1Total =
    card1.attack + card1.defending + card1.passing - card1[category];
  const player2Total =
    card2.attack + card2.defending + card2.passing - card2[category];

  if (player1Total < player2Total) {
    return { winner: "player2", decidedBy: "secondary" };
  }
  if (player1Total > player2Total) {
    return { winner: "player1", decidedBy: "secondary" };
  }

  return {
    winner: random() < 0.5 ? "player1" : "player2",
    decidedBy: "coinFlip",
  };
}
