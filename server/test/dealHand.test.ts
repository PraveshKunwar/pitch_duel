import { describe, expect, it } from "vitest";
import { dealHand } from "../src/game/dealHand";
import type { Card } from "../src/game/types";

function deck(count: number): Card[] {
  return Array.from({ length: count }, (_, index) => ({
    ID: `p-${index}`,
    name: `P${index}`,
    position: "FWD",
    attack: 50,
    defending: 50,
    passing: 50,
  }));
}

describe("dealHand", () => {
  it("returns exactly five cards from the deck", () => {
    const cards = deck(15);
    const hand = dealHand(cards);
    expect(hand).toHaveLength(5);
    expect(hand.every((card) => cards.some((dealt) => dealt.ID === card.ID))).toBe(true);
  });

  it("does not change the original deck order", () => {
    const cards = deck(15);
    const before = cards.map((card) => card.ID);
    dealHand(cards);
    expect(cards.map((card) => card.ID)).toEqual(before);
  });

  it("throws when the deck has fewer than five cards", () => {
    expect(() => dealHand(deck(4))).toThrow("Deck has less than 5 cards");
  });
});
