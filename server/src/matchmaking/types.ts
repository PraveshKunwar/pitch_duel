import type { GameMode } from "../game/modes";

export interface RatingToleranceBand {
  afterMs: number;
  maxDelta: number;
}

export interface MatchmakingConfig {
  queueKeyPrefix: string;
  joinedKeySuffix: string;
  membershipKey: string;
  maxWaitMs: number;
  tickMs: number;
  toleranceBands: RatingToleranceBand[];
}

export const DEFAULT_MATCHMAKING_CONFIG: MatchmakingConfig = {
  queueKeyPrefix: "queue:ranked",
  joinedKeySuffix: "joined",
  membershipKey: "queue:ranked:membership",
  maxWaitMs: 60_000,
  tickMs: 1_000,
  toleranceBands: [
    { afterMs: 0, maxDelta: 100 },
    { afterMs: 10_000, maxDelta: 200 },
    { afterMs: 20_000, maxDelta: 300 },
    { afterMs: 30_000, maxDelta: 500 },
  ],
};

/** Legacy single-queue shape used by createRankedQueue directly in tests. */
export interface SingleQueueConfig {
  queueKey: string;
  joinedKey: string;
  maxWaitMs: number;
  tickMs: number;
  toleranceBands: RatingToleranceBand[];
}

export const LEGACY_SINGLE_QUEUE_CONFIG: SingleQueueConfig = {
  queueKey: "queue:ranked:classic",
  joinedKey: "queue:ranked:classic:joined",
  maxWaitMs: 60_000,
  tickMs: 1_000,
  toleranceBands: DEFAULT_MATCHMAKING_CONFIG.toleranceBands,
};

export function queueKeysForMode(
  mode: GameMode,
  config: MatchmakingConfig = DEFAULT_MATCHMAKING_CONFIG,
): { queueKey: string; joinedKey: string } {
  return {
    queueKey: `${config.queueKeyPrefix}:${mode}`,
    joinedKey: `${config.queueKeyPrefix}:${mode}:${config.joinedKeySuffix}`,
  };
}

export interface QueuedPlayer {
  userId: string;
  rating: number;
  joinedAtMs: number;
  mode: GameMode;
}

export interface MatchedPair {
  player1UserId: string;
  player2UserId: string;
  player1Rating: number;
  player2Rating: number;
  mode: GameMode;
}

export function allowedRatingDelta(
  waitMs: number,
  bands: RatingToleranceBand[] = DEFAULT_MATCHMAKING_CONFIG.toleranceBands,
): number {
  let delta = bands[0]?.maxDelta ?? 0;
  for (const band of bands) {
    if (waitMs >= band.afterMs) delta = band.maxDelta;
  }
  return delta;
}
