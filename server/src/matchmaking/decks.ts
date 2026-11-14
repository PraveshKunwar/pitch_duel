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
  if (all.length < 30) {
    throw new Error("Card catalog is too small to deal a match");
  }
  const shuffled = shuffle(all);
  return {
    player1Deck: shuffled.slice(0, 15),
    player2Deck: shuffled.slice(15, 30),
  };
}

/** Unique shared pool for draft (5 packs × 3). */
export async function dealDraftPool(): Promise<Card[]> {
  const all = await cards();
  if (all.length < 15) {
    throw new Error("Card catalog is too small for draft");
  }
  return shuffle(all).slice(0, 15);
}
