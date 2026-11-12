import { describe, expect, it } from "vitest";
import { selectRandomCard } from "../src/game/selectRandomCard";
import type { Card } from "../src/game/types";

function card(id: string): Card {
  return {
    ID: id,
    name: id,
    position: "MID",
    attack: 1,
    defending: 1,
    passing: 1,
  };
}

describe("selectRandomCard", () => {
  const hand = [card("a"), card("b"), card("c")];

  it("returns a card from the hand without removing it", () => {
    const before = hand.map((played) => played.ID);
    expect(selectRandomCard(hand, () => 0).ID).toBe("a");
    expect(selectRandomCard(hand, () => 0.99).ID).toBe("c");
    expect(hand.map((played) => played.ID)).toEqual(before);
  });

  it("rejects an empty hand", () => {
    expect(() => selectRandomCard([], () => 0)).toThrow(/empty hand/);
  });
});
