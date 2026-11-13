import { loadCards } from "../game/loadCards";
import type { Card } from "../game/types";

let catalog: Promise<Card[]> | null = null;

function cards(): Promise<Card[]> {
  catalog ??= loadCards();
  return catalog;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function dealMatchDecks(): Promise<{
  player1Deck: Card[];
  player2Deck: Card[];
}> {
  const all = await cards();
  if (all.length < 5) {
    throw new Error("Card catalog is too small to deal a match");
  }
  return {
    player1Deck: shuffle(all).slice(0, Math.min(15, all.length)),
    player2Deck: shuffle(all).slice(0, Math.min(15, all.length)),
  };
}
