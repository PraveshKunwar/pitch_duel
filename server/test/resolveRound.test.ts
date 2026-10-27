import { describe, expect, it } from "vitest";
import { resolveRound } from "../src/game/resolveRound";
import type { Card } from "../src/game/types";

function card(overrides: Partial<Card> = {}): Card {
  return {
    ID: "1",
    name: "A",
    position: "FWD",
    attack: 50,
    defending: 50,
    passing: 50,
    ...overrides,
  };
}

describe("resolveRound", () => {
  it("awards the higher category stat to player 1", () => {
    expect(
      resolveRound(card({ attack: 80 }), card({ attack: 60 }), "attack"),
    ).toEqual({
      winner: "player1",
      decidedBy: "category",
    });
  });

  it("awards the higher category stat to player 2", () => {
    expect(
      resolveRound(card({ attack: 40 }), card({ attack: 70 }), "attack"),
    ).toEqual({
      winner: "player2",
      decidedBy: "category",
    });
  });

  it("breaks a category tie with the other two stats", () => {
    const card1 = card({ attack: 50, defending: 90, passing: 90 });
    const card2 = card({ attack: 50, defending: 10, passing: 10 });
    expect(resolveRound(card1, card2, "attack")).toEqual({
      winner: "player1",
      decidedBy: "secondary",
    });
  });

  it("uses the injected random when every stat ties", () => {
    const tied = card();
    expect(resolveRound(tied, tied, "attack", () => 0)).toEqual({
      winner: "player1",
      decidedBy: "coinFlip",
    });
    expect(resolveRound(tied, tied, "attack", () => 0.9)).toEqual({
      winner: "player2",
      decidedBy: "coinFlip",
    });
  });
});
