import type { Card, DraftState, PlayerSeat } from "./types";

function shuffle<T>(items: T[]): T[] {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function createDraftWithPool(
  cards: Card[],
  handSize = 5,
): { draft: DraftState; pool: Card[] } {
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
