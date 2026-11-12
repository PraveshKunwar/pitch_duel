import { randomUUID } from "node:crypto";
import { createGame } from "../game/createGame";
import type { Card, GameState, PlayerState, StatCategory } from "../game/types";

export type PlayerSeat = "player1" | "player2";

export interface GameSession {
  id: string;
  state: GameState;
  player1UserId: string;
  player2UserId: string;
  /**
   * Last accepted pick sequence per seat.
   * Day-6 limitation: process-local only. Not safe across multiple app instances
   * until live game state moves to Redis (day 8 / day 11).
   */
  lastSequence: Record<PlayerSeat, number>;
  /**
   * Epoch ms when the open round stops taking picks.
   * Null before the round is armed and after it resolves.
   */
  deadlineMs: number | null;
  /**
   * Round number whose resolution has been claimed.
   * A round can move from open to claimed only once.
   * Process-local stand-in for a Redis `SET NX` claim (day 8/11).
   */
  claimedRound: number | null;
}

export interface GameSessionStore {
  create(input: {
    player1UserId: string;
    player2UserId: string;
    player1Deck: Card[];
    player2Deck: Card[];
    firstCategory?: StatCategory;
  }): GameSession;
  get(gameId: string): GameSession | undefined;
  save(session: GameSession): void;
  seatFor(session: GameSession, userId: string): PlayerSeat | null;
  /** Fired after a session is stored. Used to arm the round timer. */
  setOnCreated(listener: ((session: GameSession) => void) | null): void;
}

export function createGameSessionStore(): GameSessionStore {
  const sessions = new Map<string, GameSession>();
  let onCreated: ((session: GameSession) => void) | null = null;

  return {
    create({
      player1UserId,
      player2UserId,
      player1Deck,
      player2Deck,
      firstCategory = "attack",
    }) {
      const session: GameSession = {
        id: randomUUID(),
        state: createGame(player1Deck, player2Deck, firstCategory),
        player1UserId,
        player2UserId,
        lastSequence: { player1: 0, player2: 0 },
        deadlineMs: null,
        claimedRound: null,
      };
      sessions.set(session.id, session);
      onCreated?.(session);
      return session;
    },

    get(gameId) {
      return sessions.get(gameId);
    },

    save(session) {
      sessions.set(session.id, session);
    },

    seatFor(session, userId) {
      if (session.player1UserId === userId) return "player1";
      if (session.player2UserId === userId) return "player2";
      return null;
    },

    setOnCreated(listener) {
      onCreated = listener;
    },
  };
}

/** Own seat only — never expose the opponent's hand or hidden pick. */
export function visiblePlayerState(
  state: GameState,
  seat: PlayerSeat,
): PlayerState {
  return {
    hand: state[seat].hand.map((card) => ({ ...card })),
    selectedCardId: state[seat].selectedCardId,
    score: state[seat].score,
  };
}

const categories: StatCategory[] = ["attack", "defending", "passing"];

export function nextCategory(current: StatCategory): StatCategory {
  const index = categories.indexOf(current);
  return categories[(index + 1) % categories.length];
}
