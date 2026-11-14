import { describe, expect, it } from "vitest";
import { summarizeMatch } from "../src/game/matchResult";
import { resolveCurrentRound } from "../src/game/resolveCurrentRound";
import { submitPick } from "../src/game/submitPick";
import type { GameState, StatCategory } from "../src/game/types";
import { flatCard } from "./helpers/cards";
import { withClassicMode } from "./helpers/gameState";

const order: StatCategory[] = ["attack", "defending", "passing"];

function play(rounds: number): GameState {
  let state: GameState = withClassicMode({
    round: 1,
    category: "attack",
    status: "picking",
    player1: {
      hand: [1, 2, 3, 4, 5].map((n) => flatCard(`a${n}`, 50)),
      selectedCardId: null,
      score: 0,
    },
    player2: {
      hand: [10, 90, 10, 90, 10].map((value, i) =>
        flatCard(`b${i + 1}`, value),
      ),
      selectedCardId: null,
      score: 0,
    },
    history: [],
  });
  for (let round = 1; round <= rounds; round += 1) {
    state = submitPick(state, "player1", state.player1.hand[0].ID);
    state = submitPick(state, "player2", state.player2.hand[0].ID);
    state = resolveCurrentRound(state, order[round % order.length]);
  }
  return state;
}

describe("summarizeMatch", () => {
  it("reports the winner, the score, and every round", () => {
    expect(summarizeMatch(play(5))).toEqual({
      winner: "player1",
      score: { player1: 3, player2: 2 },
      rounds: [
        {
          roundNo: 1,
          stat: "attack",
          card1Id: "a1",
          card2Id: "b1",
          winner: "player1",
        },
        {
          roundNo: 2,
          stat: "defending",
          card1Id: "a2",
          card2Id: "b2",
          winner: "player2",
        },
        {
          roundNo: 3,
          stat: "passing",
          card1Id: "a3",
          card2Id: "b3",
          winner: "player1",
        },
        {
          roundNo: 4,
          stat: "attack",
          card1Id: "a4",
          card2Id: "b4",
          winner: "player2",
        },
        {
          roundNo: 5,
          stat: "defending",
          card1Id: "a5",
          card2Id: "b5",
          winner: "player1",
        },
      ],
    });
  });

  it("refuses a game that is still being played", () => {
    expect(() => summarizeMatch(play(4))).toThrow(/not finished/);
  });

  it("refuses a finished game with no decisive rounds", () => {
    const state = play(5);
    expect(() =>
      summarizeMatch({ ...state, history: [] }),
    ).toThrow(/at least one round/);
  });
});
