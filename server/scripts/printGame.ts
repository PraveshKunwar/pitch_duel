import { createGame } from "../src/game/createGame";
import { loadCards } from "../src/game/loadCards";
import type { Card, GameState, StatCategory } from "../src/game/types";
import { hashPassword, verifyPassword } from "../src/auth/passwords";

const category: StatCategory = "attack";

function ids(cards: Card[]): string[] {
  return cards.map((card) => card.ID);
}

function check(game: GameState, deck: Card[], before: string[]): void {
  if (game.player1.hand.length !== 5 || game.player2.hand.length !== 5) {
    throw new Error("each hand must contain five cards");
  }
  if (game.player1.score !== 0 || game.player2.score !== 0) {
    throw new Error("both scores must be zero");
  }
  if (
    game.player1.selectedCardId !== null ||
    game.player2.selectedCardId !== null
  ) {
    throw new Error("neither player should have a selected card");
  }
  if (game.round !== 1) {
    throw new Error("round must be 1");
  }
  if (game.category !== category) {
    throw new Error(`category must be ${category}`);
  }
  if (game.history.length !== 0) {
    throw new Error("history must be empty");
  }
  if (ids(deck).join() !== before.join()) {
    throw new Error("starter deck order changed");
  }
}

async function main(): Promise<void> {
  const cards = await loadCards();
  const deck = cards.slice(0, 15);
  const before = ids(deck);
  const game = createGame(deck, deck, category);
  check(game, deck, before);
  console.log(JSON.stringify(game, null, 2));
  console.log(check2);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
