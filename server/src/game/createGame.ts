import { dealHand } from "./dealHand";
import { MODE_META, type GameMode, type Tactic } from "./modes";
import { applyTacticToHand } from "./tactics";
import type { Card, GameState, StatCategory } from "./types";

function shuffle<T>(items: T[]): T[] {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function createGameFromHands(
  player1Hand: Card[],
  player2Hand: Card[],
  options: {
    mode: GameMode;
    firstCategory?: StatCategory;
    reserve?: Card[];
    tactics?: { player1: Tactic; player2: Tactic } | null;
  },
): GameState {
  const meta = MODE_META[options.mode];
  return {
    round: 1,
    category: options.firstCategory ?? "attack",
    status: "picking",
    mode: options.mode,
    regulationRounds: meta.rounds,
    suddenDeath: false,
    reserve: options.reserve ?? [],
    tactics: options.tactics ?? null,
    player1: {
      hand: player1Hand,
      selectedCardId: null,
      score: 0,
    },
    player2: {
      hand: player2Hand,
      selectedCardId: null,
      score: 0,
    },
    history: [],
  };
}

/** Empty board used while drafting / choosing tactics. */
export function createPendingGame(
  mode: GameMode,
  firstCategory: StatCategory = "attack",
): GameState {
  const meta = MODE_META[mode];
  return {
    round: 1,
    category: firstCategory,
    status: "picking",
    mode,
    regulationRounds: meta.rounds,
    suddenDeath: false,
    reserve: [],
    tactics: null,
    player1: { hand: [], selectedCardId: null, score: 0 },
    player2: { hand: [], selectedCardId: null, score: 0 },
    history: [],
  };
}

export function createGame(
  player1Deck: Card[],
  player2Deck: Card[],
  firstCategory: StatCategory,
  mode: GameMode = "classic",
  tactics: { player1: Tactic; player2: Tactic } | null = null,
): GameState {
  const handSize = MODE_META[mode].handSize;
  const p1Raw = dealHand(player1Deck, handSize);
  const p2Raw = dealHand(player2Deck, handSize);
  const used = new Set([...p1Raw, ...p2Raw].map((c) => c.ID));
  const reserve = shuffle(
    [...player1Deck, ...player2Deck].filter((c) => !used.has(c.ID)),
  );

  const t1 = tactics?.player1 ?? "balanced";
  const t2 = tactics?.player2 ?? "balanced";
  const player1Hand =
    mode === "tactical" ? applyTacticToHand(p1Raw, t1) : p1Raw;
  const player2Hand =
    mode === "tactical" ? applyTacticToHand(p2Raw, t2) : p2Raw;

  return createGameFromHands(player1Hand, player2Hand, {
    mode,
    firstCategory,
    reserve,
    tactics: mode === "tactical" ? { player1: t1, player2: t2 } : null,
  });
}
