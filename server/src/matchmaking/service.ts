import type Redis from "ioredis";
import type { Card } from "../game/types";
import type { GameMode } from "../game/modes";
import { GAME_MODES } from "../game/modes";
import {
  createLocalGameFanout,
  type GameFanout,
} from "../ws/fanout";
import type { GameSessionStore } from "../ws/gameSessions";
import type { AuthenticatedSocket, ServerMessage } from "../ws/types";
import { dealMatchDecks } from "./decks";
import { findAndClaimOpponent } from "./matcher";
import { createModeQueues, type ModeQueues } from "./queue";
import {
  DEFAULT_MATCHMAKING_CONFIG,
  type MatchmakingConfig,
  type MatchedPair,
} from "./types";

export interface MatchmakingDependencies {
  redis: Redis;
  sessions: GameSessionStore;
  getRating: (userId: string) => Promise<number | null>;
  /** Optional; used for lobby/game UI labels on matchmaking:found + session meta. */
  getUsername?: (userId: string) => Promise<string | null>;
  getSocket: (userId: string) => AuthenticatedSocket | undefined;
  send: (socket: AuthenticatedSocket, message: ServerMessage) => void;
  fanout?: GameFanout;
  dealDecks?: () => Promise<{ player1Deck: Card[]; player2Deck: Card[] }>;
  now?: () => number;
  config?: Partial<MatchmakingConfig>;
}

export interface MatchmakingService {
  join(userId: string, mode: GameMode): Promise<void>;
  cancel(userId: string): Promise<void>;
  onDisconnect(userId: string): Promise<void>;
  dispose(): void;
  queues: ModeQueues;
  /** @deprecated use queues.forMode('classic') — kept for older tests */
  queue: ModeQueues["forMode"] extends (m: GameMode) => infer R ? R : never;
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
  const queues = createModeQueues(deps.redis, config);
  const now = deps.now ?? Date.now;
  const dealDecks = deps.dealDecks ?? dealMatchDecks;
  const fanout =
    deps.fanout ?? createLocalGameFanout(deps.getSocket, deps.send);
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
    void fanout.notifyUser(userId, message);
  };

  const resolveUsername = async (userId: string): Promise<string> => {
    if (!deps.getUsername) return "Opponent";
    return (await deps.getUsername(userId)) ?? "Opponent";
  };

  const createMatchedGame = async (pair: MatchedPair): Promise<string> => {
    const decks = await dealDecks();
    const [player1Username, player2Username] = await Promise.all([
      resolveUsername(pair.player1UserId),
      resolveUsername(pair.player2UserId),
    ]);
    // Clear membership — claim already removed from ZSET, but membership may linger
    // until remove(); claimClosest doesn't touch membership. Clear both seats.
    await queues.remove(pair.player1UserId);
    await queues.remove(pair.player2UserId);

    const session = await deps.sessions.create({
      player1UserId: pair.player1UserId,
      player2UserId: pair.player2UserId,
      player1Deck: decks.player1Deck,
      player2Deck: decks.player2Deck,
      player1Username,
      player2Username,
      player1Rating: pair.player1Rating,
      player2Rating: pair.player2Rating,
      mode: pair.mode,
    });

    notify(pair.player1UserId, {
      type: "matchmaking:found",
      gameId: session.id,
      opponentRating: pair.player2Rating,
      opponentUsername: player2Username,
      mode: pair.mode,
    });
    notify(pair.player2UserId, {
      type: "matchmaking:found",
      gameId: session.id,
      opponentRating: pair.player1Rating,
      opponentUsername: player1Username,
      mode: pair.mode,
    });

    return session.id;
  };

  const tryMatch = async (
    seekerId: string,
    mode: GameMode,
  ): Promise<boolean> => {
    const attempt = await findAndClaimOpponent(
      queues.forMode(mode),
      seekerId,
      now(),
      mode,
      config,
    );
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
    const current = now();

    for (const mode of GAME_MODES) {
      const players = await queues.list(mode);
      for (const player of players) {
        const waited = current - player.joinedAtMs;
        if (waited >= config.maxWaitMs) {
          const removed = await queues.remove(player.userId);
          if (removed) {
            notify(player.userId, { type: "matchmaking:timeout" });
          }
          continue;
        }
        await tryMatch(player.userId, mode);
      }
    }
  };

  const timer = setInterval(() => {
    void tick().catch(() => {
      // Tick failures are non-fatal; the next interval retries.
    });
  }, config.tickMs);
  timer.unref?.();

  return {
    queues,
    get queue() {
      return queues.forMode("classic");
    },

    tick,

    async join(userId, mode) {
      await withLock(userId, async () => {
        if (await deps.sessions.activeGameFor(userId)) {
          notify(userId, {
            type: "error",
            message: "Already in an active game",
          });
          return;
        }

        if (await queues.isQueued(userId)) {
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
        const added = await queues.add(mode, userId, rating, joinedAtMs);
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
          mode,
        });

        await tryMatch(userId, mode);
      });
    },

    async cancel(userId) {
      await withLock(userId, async () => {
        const removed = await queues.remove(userId);
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
      await queues.remove(userId);
    },

    dispose() {
      clearInterval(timer);
    },
  };
}
