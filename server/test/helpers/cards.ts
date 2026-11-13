import type { Card, StatCategory } from "../../src/game/types";
import type { PickStrategy } from "./ws";

export function flatCard(id: string, value: number): Card {
  return {
    ID: id,
    name: id,
    position: "MID",
    attack: value,
    defending: value,
    passing: value,
  };
}

export const scripted: {
  player1Deck: Card[];
  player2Deck: Card[];
  player2Pick: PickStrategy;
  roundWinners: Array<"player1" | "player2">;
  roundStats: StatCategory[];
} = {
  player1Deck: [1, 2, 3, 4, 5].map((n) => flatCard(`mid-${n}`, 50)),
  player2Deck: [
    flatCard("strong-1", 90),
    flatCard("strong-2", 90),
    flatCard("weak-1", 10),
    flatCard("weak-2", 10),
    flatCard("weak-3", 10),
  ],
  player2Pick: (round, hand) => {
    const wanted = round === 2 || round === 4 ? "strong" : "weak";
    const card = hand.find((candidate) => candidate.ID.startsWith(wanted));
    if (!card) throw new Error(`no ${wanted} card left for round ${round}`);
    return card.ID;
  },
  roundWinners: ["player1", "player2", "player1", "player2", "player1"],
  roundStats: ["attack", "defending", "passing", "attack", "defending"],
};
