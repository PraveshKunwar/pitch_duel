import type Redis from "ioredis";
import type { Card } from "../game/types";
import type { GameSessionStore } from "../ws/gameSessions";
import type { AuthenticatedSocket, ServerMessage } from "../ws/types";
import { dealMatchDecks } from "./decks";
import { findAndClaimOpponent } from "./matcher";
import { createRankedQueue, type RankedQueue } from "./queue";
import {
  DEFAULT_MATCHMAKING_CONFIG,
  type MatchmakingConfig,
  type MatchedPair,
} from "./types";

export interface MatchmakingDependencies {
  redis: Redis;
  sessions: GameSessionStore;
  getRating: (userId: string) => Promise<number | null>;
  getSocket: (userId: string) => AuthenticatedSocket | undefined;
  send: (socket: AuthenticatedSocket, message: ServerMessage) => void;
  dealDecks?: () => Promise<{ player1Deck: Card[]; player2Deck: Card[] }>;
  now?: () => number;
  config?: Partial<MatchmakingConfig>;
}

export interface MatchmakingService {
  join(userId: string): Promise<void>;
  cancel(userId: string): Promise<void>;
  onDisconnect(userId: string): Promise<void>;
  dispose(): void;
  queue: RankedQueue;
  tick(): Promise<void>;
}

export function createMatchmakingService(
  deps: MatchmakingDependencies,
): MatchmakingService {
  const config: MatchmakingConfig = {
    ...DEFAULT_MATCHMAKING_CONFIG,
    ...deps.config,
    toleranceBands:
      deps.config?.toleranceBands ?? DEFAULT_MATCHMAKING_CONFIG.toleranceBands,
  };
  const queue = createRankedQueue(deps.redis, config);
  const now = deps.now ?? Date.now;
  const dealDecks = deps.dealDecks ?? dealMatchDecks;
  const locks = new Map<string, Promise<void>>();

  const withLock = async (
    userId: string,
    work: () => Promise<void>,
  ): Promise<void> => {
    const previous = locks.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => gate);
    locks.set(userId, chain);
    await previous;
    try {
      await work();
    } finally {
      release();
      if (locks.get(userId) === chain) locks.delete(userId);
    }
  };

  const notify = (userId: string, message: ServerMessage): void => {
    const socket = deps.getSocket(userId);
    if (socket) deps.send(socket, message);
  };

  const createMatchedGame = async (pair: MatchedPair): Promise<string> => {
    const decks = await dealDecks();
    const session = await deps.sessions.create({
      player1UserId: pair.player1UserId,
      player2UserId: pair.player2UserId,
      player1Deck: decks.player1Deck,
      player2Deck: decks.player2Deck,
    });

    notify(pair.player1UserId, {
      type: "matchmaking:found",
      gameId: session.id,
      opponentRating: pair.player2Rating,
    });
    notify(pair.player2UserId, {
      type: "matchmaking:found",
      gameId: session.id,
      opponentRating: pair.player1Rating,
    });

    return session.id;
  };

  const tryMatch = async (seekerId: string): Promise<boolean> => {
    const attempt = await findAndClaimOpponent(queue, seekerId, now(), config);
    if (!attempt.matched) return false;
    try {
      await createMatchedGame(attempt.matched);
      return true;
    } catch {
      notify(attempt.matched.player1UserId, {
        type: "error",
        message: "Failed to create matched game",
      });
      notify(attempt.matched.player2UserId, {
        type: "error",
        message: "Failed to create matched game",
      });
      return false;
    }
  };

  const tick = async (): Promise<void> => {
    const players = await queue.list();
    const current = now();

    for (const player of players) {
      const waited = current - player.joinedAtMs;
      if (waited >= config.maxWaitMs) {
        const removed = await queue.remove(player.userId);
        if (removed) {
          notify(player.userId, { type: "matchmaking:timeout" });
        }
        continue;
      }
      await tryMatch(player.userId);
    }
  };

  const timer = setInterval(() => {
    void tick().catch(() => {
      // Tick failures are non-fatal; the next interval retries.
    });
  }, config.tickMs);
  timer.unref?.();

  return {
    queue,

    tick,

    async join(userId) {
      await withLock(userId, async () => {
        if (await deps.sessions.activeGameFor(userId)) {
          notify(userId, {
            type: "error",
            message: "Already in an active game",
          });
          return;
        }

        if (await queue.isQueued(userId)) {
          notify(userId, {
            type: "error",
            message: "Already in matchmaking queue",
          });
          return;
        }

        const rating = await deps.getRating(userId);
        if (rating === null) {
          notify(userId, { type: "error", message: "User not found" });
          return;
        }

        const joinedAtMs = now();
        const added = await queue.add(userId, rating, joinedAtMs);
        if (!added) {
          notify(userId, {
            type: "error",
            message: "Already in matchmaking queue",
          });
          return;
        }

        notify(userId, {
          type: "matchmaking:queued",
          rating,
          queuedAtMs: joinedAtMs,
        });

        await tryMatch(userId);
      });
    },

    async cancel(userId) {
      await withLock(userId, async () => {
        const removed = await queue.remove(userId);
        if (!removed) {
          notify(userId, {
            type: "error",
            message: "Not in matchmaking queue",
          });
          return;
        }
        notify(userId, { type: "matchmaking:cancelled" });
      });
    },

    async onDisconnect(userId) {
      await queue.remove(userId);
    },

    dispose() {
      clearInterval(timer);
    },
  };
}
