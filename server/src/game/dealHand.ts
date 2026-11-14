import type { Card } from "./types";

function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function dealHand(deck: Card[], handSize = 5): Card[] {
  if (deck.length < handSize) {
    throw new Error(`Deck has less than ${handSize} cards`);
  }
  const shuffled = shuffle([...deck]);
  return shuffled.slice(0, handSize);
}
