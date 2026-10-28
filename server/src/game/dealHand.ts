import type { Card } from "./types";

function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function dealHand(deck: Card[]): Card[] {
  if (deck.length < 5) {
    throw new Error("Deck has less than 5 cards");
  }
  const shuffle_deck = shuffle([...deck]);
  return shuffle_deck.slice(0, 5);
}
