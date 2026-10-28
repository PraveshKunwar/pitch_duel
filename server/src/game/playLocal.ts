import { createGame } from "./createGame";
import { loadCards } from "./loadCards";
import { resolveCurrentRound } from "./resolveCurrentRound";
import { submitPick } from "./submitPick";
import type { GameState, StatCategory } from "./types";

const categories: StatCategory[] = ["attack", "defending", "passing"];

function nextCategory(current: StatCategory): StatCategory {
  const idx = categories.indexOf(current);
  return categories[(idx + 1) % categories.length];
}

function pickRemaining(
  state: GameState,
  player: "player1" | "player2",
): string {
  const card = state[player].hand[0];
  if (!card) {
    throw new Error(`${player} has no cards left`);
  }
  return card.ID;
}

export async function playLocal() {
  const cards = await loadCards();
  const deck = cards.slice(0, 15);
  let state = createGame(deck, deck, "attack");

  while (state.status !== "finished") {
    state = submitPick(state, "player1", pickRemaining(state, "player1"));
    state = submitPick(state, "player2", pickRemaining(state, "player2"));
    state = resolveCurrentRound(state, nextCategory(state.category));
    const latest = state.history[state.history.length - 1];
    console.log(
      `round ${latest.round} ${latest.category}: ${latest.result.winner} by ${latest.result.decidedBy} (${latest.card1.name} vs ${latest.card2.name})`,
    );
    console.log(`score ${state.player1.score}-${state.player2.score}`);
  }

  if (state.player1.score === state.player2.score) {
    console.log("draw");
  } else {
    const winner =
      state.player1.score > state.player2.score ? "player1" : "player2";
    console.log(`${winner} wins ${state.player1.score}-${state.player2.score}`);
  }

  return state;
}

if (require.main === module) {
  playLocal().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
