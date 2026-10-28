import { describe, expect, it } from "vitest";
import { resolveCurrentRound } from "../src/game/resolveCurrentRound";
import { submitPick } from "../src/game/submitPick";
import type { Card, GameState } from "../src/game/types";

function card(id: string, attack: number): Card {
  return {
    ID: id,
    name: id,
    position: "FWD",
    attack,
    defending: 50,
    passing: 50,
  };
}

function game(round = 1): GameState {
  return {
    round,
    category: "attack",
    status: "picking",
    player1: {
      hand: [card("a", 80), card("b", 10)],
      selectedCardId: null,
      score: 0,
    },
    player2: {
      hand: [card("c", 40), card("d", 10)],
      selectedCardId: null,
      score: 0,
    },
    history: [],
  };
}

describe("resolveCurrentRound", () => {
  it("scores the round, drops both played cards, and leaves the input unchanged", () => {
    let state = game();
    state = submitPick(state, "player1", "a");
    state = submitPick(state, "player2", "c");
    const before = structuredClone(state);

    const next = resolveCurrentRound(state, "passing");

    expect(state).toEqual(before);
    expect(next.player1.score).toBe(1);
    expect(next.player2.score).toBe(0);
    expect(next.player1.hand.map((played) => played.ID)).toEqual(["b"]);
    expect(next.player2.hand.map((played) => played.ID)).toEqual(["d"]);
    expect(next.player1.selectedCardId).toBeNull();
    expect(next.player2.selectedCardId).toBeNull();
    expect(next.history).toEqual([
      {
        round: 1,
        category: "attack",
        card1: card("a", 80),
        card2: card("c", 40),
        result: { winner: "player1", decidedBy: "category" },
      },
    ]);
    expect(next.round).toBe(2);
    expect(next.category).toBe("passing");
    expect(next.status).toBe("picking");
  });

  it("finishes on round 5 without advancing the round or category", () => {
    let state = game(5);
    state = submitPick(state, "player1", "a");
    state = submitPick(state, "player2", "c");

    const next = resolveCurrentRound(state, "passing");

    expect(next.status).toBe("finished");
    expect(next.round).toBe(5);
    expect(next.category).toBe("attack");
    expect(next.player1.score).toBe(1);
    expect(next.history).toHaveLength(1);
  });

  it("rejects a resolve after the game is finished", () => {
    const state = game();
    state.status = "finished";

    expect(() => resolveCurrentRound(state, "passing")).toThrow(
      "Cannot resolve a round: the game is finished",
    );
  });
});
