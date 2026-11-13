import type {
  Card,
  CompletedRound,
  DraftState,
  GameMode,
  GameState,
  PlayerSeat,
  PlayerState,
  StatCategory,
  Tactic,
} from "../types/game";
import { MODE_META, TACTIC_META, clampStat } from "./modes";

const CATEGORIES: StatCategory[] = ["attack", "defending", "passing"];

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function dealHand(deck: Card[], handSize: number): Card[] {
  if (deck.length < handSize) {
    throw new Error(`Deck has less than ${handSize} cards`);
  }
  return shuffle(deck).slice(0, handSize);
}

export function nextCategory(current: StatCategory): StatCategory {
  const idx = CATEGORIES.indexOf(current);
  return CATEGORIES[(idx + 1) % CATEGORIES.length];
}

export function applyTactic(card: Card, tactic: Tactic): Card {
  const mod = TACTIC_META[tactic];
  return {
    ...card,
    attack: clampStat(card.attack + mod.attack),
    defending: clampStat(card.defending + mod.defending),
    passing: clampStat(card.passing + mod.passing),
  };
}

export function applyTacticToHand(hand: Card[], tactic: Tactic): Card[] {
  if (tactic === "balanced") return hand.map((c) => ({ ...c }));
  return hand.map((c) => applyTactic(c, tactic));
}

export function buildDecks(cards: Card[]): {
  player1Deck: Card[];
  player2Deck: Card[];
} {
  const shuffled = shuffle(cards);
  return {
    player1Deck: shuffled.slice(0, 15),
    player2Deck: shuffled.slice(15, 30),
  };
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

export function createGame(
  player1Deck: Card[],
  player2Deck: Card[],
  mode: GameMode = "classic",
  firstCategory: StatCategory = "attack",
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

/** Shared pool draft: packs of 3, each seat takes one, leftover burned. */
export function createDraftWithPool(cards: Card[], handSize = 5): {
  draft: DraftState;
  pool: Card[];
} {
  const totalPacks = handSize;
  const needed = totalPacks * 3;
  if (cards.length < needed) {
    throw new Error(`Need at least ${needed} cards for draft`);
  }
  const pool = shuffle(cards).slice(0, needed);
  return {
    pool,
    draft: {
      packIndex: 0,
      totalPacks,
      currentPack: pool.slice(0, 3),
      picksInPack: 0,
      nextPicker: "player1",
      nextPackFirstPicker: "player2",
      player1Picks: [],
      player2Picks: [],
      handSize,
    },
  };
}

export function draftPick(
  draft: DraftState,
  pool: Card[],
  seat: PlayerSeat,
  cardId: string,
): { draft: DraftState; complete: boolean } {
  if (draft.nextPicker !== seat) {
    throw new Error("Not your pick");
  }
  if (seat === "player1" && draft.player1Picks.length >= draft.handSize) {
    throw new Error("Hand full");
  }
  if (seat === "player2" && draft.player2Picks.length >= draft.handSize) {
    throw new Error("Hand full");
  }

  const card = draft.currentPack.find((c) => c.ID === cardId);
  if (!card) throw new Error("Card not in pack");

  const remainingPack = draft.currentPack.filter((c) => c.ID !== cardId);
  const player1Picks =
    seat === "player1" ? [...draft.player1Picks, card] : draft.player1Picks;
  const player2Picks =
    seat === "player2" ? [...draft.player2Picks, card] : draft.player2Picks;
  const picksInPack = draft.picksInPack + 1;

  // First pick of the pack → opponent chooses from the remaining two.
  if (picksInPack < 2) {
    return {
      complete: false,
      draft: {
        ...draft,
        currentPack: remainingPack,
        picksInPack,
        nextPicker: seat === "player1" ? "player2" : "player1",
        player1Picks,
        player2Picks,
      },
    };
  }

  const handsFull =
    player1Picks.length >= draft.handSize &&
    player2Picks.length >= draft.handSize;
  if (handsFull) {
    return {
      complete: true,
      draft: {
        ...draft,
        currentPack: [],
        picksInPack: 0,
        player1Picks,
        player2Picks,
      },
    };
  }

  const burnedIds = new Set(
    [...player1Picks, ...player2Picks, ...remainingPack].map((c) => c.ID),
  );
  const unused = pool.filter((c) => !burnedIds.has(c.ID));
  const nextPack = unused.slice(0, 3);
  const first = draft.nextPackFirstPicker;

  return {
    complete: false,
    draft: {
      ...draft,
      packIndex: draft.packIndex + 1,
      currentPack: nextPack,
      picksInPack: 0,
      nextPicker: first,
      nextPackFirstPicker: first === "player1" ? "player2" : "player1",
      player1Picks,
      player2Picks,
    },
  };
}

export function finishDraft(draft: DraftState): GameState {
  if (
    draft.player1Picks.length < draft.handSize ||
    draft.player2Picks.length < draft.handSize
  ) {
    throw new Error("Draft incomplete");
  }
  return createGameFromHands(draft.player1Picks, draft.player2Picks, {
    mode: "draft",
  });
}

/** CPU: take highest overall; slight deny bias toward opponent's best ATK/DEF. */
export function cpuDraftPick(pack: Card[]): string {
  if (pack.length === 0) throw new Error("Empty pack");
  let best = pack[0];
  let bestScore = -Infinity;
  for (const card of pack) {
    const overall = card.attack + card.defending + card.passing;
    const deny = Math.max(card.attack, card.defending);
    const score = overall + deny * 0.25;
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return best.ID;
}

export function cpuTactic(): Tactic {
  const options: Tactic[] = [
    "attacking",
    "defensive",
    "possession",
    "balanced",
  ];
  return options[Math.floor(Math.random() * options.length)];
}

export function submitPick(
  state: GameState,
  player: PlayerSeat,
  cardId: string,
): GameState {
  if (state.status === "finished") {
    throw new Error("Game finished");
  }
  const seat = state[player];
  if (seat.selectedCardId !== null) {
    throw new Error("Already selected");
  }
  if (!seat.hand.some((card) => card.ID === cardId)) {
    throw new Error("Card not in hand");
  }
  return {
    ...state,
    [player]: { ...seat, selectedCardId: cardId },
  };
}

function resolveRound(
  card1: Card,
  card2: Card,
  category: StatCategory,
  allowDraw: boolean,
): CompletedRound["result"] {
  if (card1[category] < card2[category]) {
    return { winner: "player2", decidedBy: "category" };
  }
  if (card1[category] > card2[category]) {
    return { winner: "player1", decidedBy: "category" };
  }
  const p1 =
    card1.attack + card1.defending + card1.passing - card1[category];
  const p2 =
    card2.attack + card2.defending + card2.passing - card2[category];
  if (p1 < p2) return { winner: "player2", decidedBy: "secondary" };
  if (p1 > p2) return { winner: "player1", decidedBy: "secondary" };
  if (allowDraw) return { winner: null, decidedBy: "draw" };
  return {
    winner: Math.random() < 0.5 ? "player1" : "player2",
    decidedBy: "coinFlip",
  };
}

function dealSuddenDeathCards(state: GameState): {
  player1Hand: Card[];
  player2Hand: Card[];
  reserve: Card[];
} {
  if (state.reserve.length < 2) {
    throw new Error("Not enough reserve cards for sudden death");
  }
  const [c1, c2, ...rest] = state.reserve;
  return {
    player1Hand: [c1],
    player2Hand: [c2],
    reserve: rest,
  };
}

export function resolveCurrentRound(state: GameState): GameState {
  if (
    state.player1.selectedCardId === null ||
    state.player2.selectedCardId === null
  ) {
    throw new Error("Both picks required");
  }
  const card1 = state.player1.hand.find(
    (c) => c.ID === state.player1.selectedCardId,
  );
  const card2 = state.player2.hand.find(
    (c) => c.ID === state.player2.selectedCardId,
  );
  if (!card1 || !card2) throw new Error("Selected card missing");

  // Regulation sudden-death mode can draw; overtime / other modes always decide.
  const allowDraw = state.mode === "sudden_death" && !state.suddenDeath;
  const result = resolveRound(card1, card2, state.category, allowDraw);
  const completed: CompletedRound = {
    round: state.round,
    category: state.category,
    card1,
    card2,
    result,
  };

  const player1Score =
    state.player1.score + (result.winner === "player1" ? 1 : 0);
  const player2Score =
    state.player2.score + (result.winner === "player2" ? 1 : 0);

  const player1Hand = state.player1.hand.filter((c) => c.ID !== card1.ID);
  const player2Hand = state.player2.hand.filter((c) => c.ID !== card2.ID);

  // Overtime SD: first decisive (non-draw) round ends the match.
  if (state.suddenDeath) {
    if (result.winner === null) {
      // Extremely rare with coinFlip disabled only in regulation; keep going.
      const next = dealSuddenDeathCards({ ...state, reserve: state.reserve });
      return {
        ...state,
        player1: {
          ...state.player1,
          score: player1Score,
          hand: next.player1Hand,
          selectedCardId: null,
        },
        player2: {
          ...state.player2,
          score: player2Score,
          hand: next.player2Hand,
          selectedCardId: null,
        },
        reserve: next.reserve,
        history: [...state.history, completed],
        status: "picking",
        round: state.round + 1,
        category: nextCategory(state.category),
      };
    }
    return {
      ...state,
      player1: {
        ...state.player1,
        score: player1Score,
        hand: player1Hand,
        selectedCardId: null,
      },
      player2: {
        ...state.player2,
        score: player2Score,
        hand: player2Hand,
        selectedCardId: null,
      },
      history: [...state.history, completed],
      status: "finished",
    };
  }

  const regulationComplete = state.round >= state.regulationRounds;

  if (regulationComplete) {
    const tied = player1Score === player2Score;
    if (state.mode === "sudden_death" && tied) {
      const next = dealSuddenDeathCards({
        ...state,
        reserve: state.reserve,
      });
      return {
        ...state,
        player1: {
          ...state.player1,
          score: player1Score,
          hand: next.player1Hand,
          selectedCardId: null,
        },
        player2: {
          ...state.player2,
          score: player2Score,
          hand: next.player2Hand,
          selectedCardId: null,
        },
        reserve: next.reserve,
        history: [...state.history, completed],
        status: "picking",
        suddenDeath: true,
        round: state.round + 1,
        category: nextCategory(state.category),
      };
    }
    return {
      ...state,
      player1: {
        ...state.player1,
        score: player1Score,
        hand: player1Hand,
        selectedCardId: null,
      },
      player2: {
        ...state.player2,
        score: player2Score,
        hand: player2Hand,
        selectedCardId: null,
      },
      history: [...state.history, completed],
      status: "finished",
    };
  }

  return {
    ...state,
    player1: {
      ...state.player1,
      score: player1Score,
      hand: player1Hand,
      selectedCardId: null,
    },
    player2: {
      ...state.player2,
      score: player2Score,
      hand: player2Hand,
      selectedCardId: null,
    },
    history: [...state.history, completed],
    status: "picking",
    round: state.round + 1,
    category: nextCategory(state.category),
  };
}

/** CPU picks the hand card with the best current category stat. */
export function cpuPick(hand: Card[], category: StatCategory): string {
  let best = hand[0];
  for (const card of hand) {
    if (card[category] > best[category]) best = card;
  }
  return best.ID;
}

export function visiblePlayerState(state: PlayerState): PlayerState {
  return {
    hand: state.hand.map((c) => ({ ...c })),
    selectedCardId: state.selectedCardId,
    score: state.score,
  };
}

export function matchWinner(state: GameState): PlayerSeat | null {
  if (state.status !== "finished") return null;
  if (state.player1.score > state.player2.score) return "player1";
  if (state.player2.score > state.player1.score) return "player2";
  return null;
}
