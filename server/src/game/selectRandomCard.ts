import type { Card } from "./types";

/** Pick one card from the player's remaining hand. Does not remove it. */
export function selectRandomCard(
  hand: Card[],
  random: () => number = Math.random,
): Card {
  if (hand.length === 0) {
    throw new Error("Cannot select a card from an empty hand");
  }
  const index = Math.min(
    hand.length - 1,
    Math.max(0, Math.floor(random() * hand.length)),
  );
  const card = hand[index];
  if (!card) {
    throw new Error("Cannot select a card from an empty hand");
  }
  return card;
}
