import { describe, expect, it } from "vitest";
import { resolveCurrentRound } from "../src/game/resolveCurrentRound";
import { submitPick } from "../src/game/submitPick";
import type { Card, GameState, StatCategory } from "../src/game/types";

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

function game(): GameState {
  return {
    round: 1,
    category: "attack",
    status: "picking",
    mode: "classic",
    regulationRounds: 5,
    suddenDeath: false,
    reserve: [],
    tactics: null,
    player1: {
      hand: [card("a", 80), card("b", 70), card("c", 60), card("d", 50), card("e", 40)],
      selectedCardId: null,
      score: 0,
    },
    player2: {
      hand: [card("v", 10), card("w", 20), card("x", 30), card("y", 35), card("z", 36)],
      selectedCardId: null,
      score: 0,
    },
    history: [],
  };
}

function playRound(state: GameState, nextCategory: StatCategory): GameState {
  const player1Card = state.player1.hand[0];
  const player2Card = state.player2.hand[0];
  if (!player1Card || !player2Card) {
    throw new Error("a player has no cards left");
  }
  const player1Picked = submitPick(state, "player1", player1Card.ID);
  const bothPicked = submitPick(player1Picked, "player2", player2Card.ID);
  return resolveCurrentRound(bothPicked, nextCategory);
}

describe("match", () => {
  it("finishes a complete match", () => {
    let state = game();
    const nextCategories: StatCategory[] = ["defending", "passing", "attack", "defending", "passing"];

    for (const nextCategory of nextCategories) {
      state = playRound(state, nextCategory);
    }

    expect(state.status).toBe("finished");
    expect(state.round).toBe(5);
    expect(state.history).toHaveLength(5);
    expect(state.player1.score).toBe(5);
    expect(state.player2.score).toBe(0);
    expect(state.player1.hand).toEqual([]);
    expect(state.player2.hand).toEqual([]);
    expect(state.player1.selectedCardId).toBeNull();
    expect(state.player2.selectedCardId).toBeNull();
  });

  it("rejects a second pick in the same round", () => {
    const once = submitPick(game(), "player1", "a");

    expect(() => submitPick(once, "player1", "b")).toThrow("Player has already selected a card");
  });

  it("rejects a card that is not in the player's hand", () => {
    expect(() => submitPick(game(), "player1", "v")).toThrow("Card isn't in this players hand");
  });

  it("rejects a card that was already played", () => {
    const played = playRound(game(), "defending");

    expect(() => submitPick(played, "player1", "a")).toThrow("Card isn't in this players hand");
  });

  it("fails resolution when either pick is missing", () => {
    const state = game();
    const message = "Both players must selected a card before resolving";

    expect(() => resolveCurrentRound(state, "passing")).toThrow(message);
    expect(() => resolveCurrentRound(submitPick(state, "player1", "a"), "passing")).toThrow(message);
    expect(() => resolveCurrentRound(submitPick(state, "player2", "v"), "passing")).toThrow(message);
  });

  it("rejects picks and resolution after the match is finished", () => {
    let state = game();
    for (const nextCategory of ["defending", "passing", "attack", "defending", "passing"] as const) {
      state = playRound(state, nextCategory);
    }

    expect(() => submitPick(state, "player1", "a")).toThrow("Cannot submit a pick: the game is finished");
    expect(() => resolveCurrentRound(state, "attack")).toThrow(
      "Cannot resolve a round: the game is finished",
    );
  });

  it("preserves the input state of submitPick and resolveCurrentRound", () => {
    const state = game();
    const beforePick = structuredClone(state);
    const picked = submitPick(state, "player1", "a");

    expect(state).toEqual(beforePick);
    expect(picked.player1.selectedCardId).toBe("a");

    const both = submitPick(picked, "player2", "v");
    const beforeResolve = structuredClone(both);
    const resolved = resolveCurrentRound(both, "passing");

    expect(both).toEqual(beforeResolve);
    expect(resolved.player1.score).toBe(1);
    expect(resolved.history).toHaveLength(1);
  });
});
