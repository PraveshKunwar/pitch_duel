import { randomUUID } from "node:crypto";
import { createGame } from "../game/createGame";
import type { Card, GameState, PlayerState, StatCategory } from "../game/types";

export type PlayerSeat = "player1" | "player2";

export interface PlayerConnectionState {
  connected: boolean;
  connectionId: string | null;
  disconnectedAt: number | null;
  gracePeriodExpiresAt: number | null;
}

export type SessionOutcome =
  | { kind: "completed" }
  | { kind: "forfeit"; winner: PlayerSeat; forfeitedBy: PlayerSeat }
  | { kind: "abandoned" };

export interface GameSession {
  id: string;
  version: number;
  state: GameState;
  player1UserId: string;
  player2UserId: string;
  lastSequence: Record<PlayerSeat, number>;
  deadlineMs: number | null;
  startedAtMs: number;
  endedAtMs: number | null;
  connections: Record<PlayerSeat, PlayerConnectionState>;
  frozen: boolean;
  pausedRemainingMs: number | null;
  outcome: SessionOutcome | null;
}

export function initialConnectionState(
  connected = false,
): PlayerConnectionState {
  return {
    connected,
    connectionId: null,
    disconnectedAt: null,
    gracePeriodExpiresAt: null,
  };
}

export function isTerminal(session: GameSession): boolean {
  return session.state.status === "finished" || session.outcome !== null;
}

export function userIdForSeat(
  session: GameSession,
  seat: PlayerSeat,
): string {
  return seat === "player1" ? session.player1UserId : session.player2UserId;
}

export function opponentSeat(seat: PlayerSeat): PlayerSeat {
  return seat === "player1" ? "player2" : "player1";
}

export interface CreateSessionInput {
  player1UserId: string;
  player2UserId: string;
  player1Deck: Card[];
  player2Deck: Card[];
  firstCategory?: StatCategory;
  startedAtMs?: number;
}

export type SessionCreatedListener = (
  session: GameSession,
) => void | Promise<unknown>;

export interface GameSessionStore {
  create(input: CreateSessionInput): Promise<GameSession>;
  get(gameId: string): Promise<GameSession | null>;
  update(next: GameSession): Promise<GameSession | null>;
  activeGameFor(userId: string): Promise<string | null>;
  unpersisted(): Promise<string[]>;
  markPersisted(gameId: string, userIds?: string[]): Promise<void>;
  setOnCreated(listener: SessionCreatedListener | null): void;
}

export function buildSession(input: CreateSessionInput): GameSession {
  return {
    id: randomUUID(),
    version: 1,
    state: createGame(
      input.player1Deck,
      input.player2Deck,
      input.firstCategory ?? "attack",
    ),
    player1UserId: input.player1UserId,
    player2UserId: input.player2UserId,
    lastSequence: { player1: 0, player2: 0 },
    deadlineMs: null,
    startedAtMs: input.startedAtMs ?? Date.now(),
    endedAtMs: null,
    connections: {
      player1: initialConnectionState(false),
      player2: initialConnectionState(false),
    },
    frozen: false,
    pausedRemainingMs: null,
    outcome: null,
  };
}

export function createGameSessionStore(): GameSessionStore {
  const sessions = new Map<string, { version: number; data: string }>();
  const userGames = new Map<string, string>();
  const unpersisted = new Set<string>();
  let onCreated: SessionCreatedListener | null = null;

  const read = (gameId: string): GameSession | null => {
    const stored = sessions.get(gameId);
    return stored ? (JSON.parse(stored.data) as GameSession) : null;
  };

  return {
    async create(input) {
      const session = buildSession(input);
      sessions.set(session.id, {
        version: session.version,
        data: JSON.stringify(session),
      });
      userGames.set(session.player1UserId, session.id);
      userGames.set(session.player2UserId, session.id);
      if (!onCreated) return session;
      await onCreated(session);
      return read(session.id) ?? session;
    },

    async get(gameId) {
      return read(gameId);
    },

    async update(next) {
      const stored = sessions.get(next.id);
      if (!stored || stored.version !== next.version) return null;
      const saved: GameSession = { ...next, version: next.version + 1 };
      sessions.set(saved.id, {
        version: saved.version,
        data: JSON.stringify(saved),
      });
      if (isTerminal(saved)) unpersisted.add(saved.id);
      return read(saved.id);
    },

    async activeGameFor(userId) {
      return userGames.get(userId) ?? null;
    },

    async unpersisted() {
      return [...unpersisted];
    },

    async markPersisted(gameId, userIds = []) {
      unpersisted.delete(gameId);
      for (const userId of userIds) {
        if (userGames.get(userId) === gameId) userGames.delete(userId);
      }
    },

    setOnCreated(listener) {
      onCreated = listener;
    },
  };
}

export function seatFor(
  session: GameSession,
  userId: string,
): PlayerSeat | null {
  if (session.player1UserId === userId) return "player1";
  if (session.player2UserId === userId) return "player2";
  return null;
}

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
