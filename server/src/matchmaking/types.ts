export interface RatingToleranceBand {
  afterMs: number;
  maxDelta: number;
}

export interface MatchmakingConfig {
  queueKey: string;
  joinedKey: string;
  maxWaitMs: number;
  tickMs: number;
  toleranceBands: RatingToleranceBand[];
}

export const DEFAULT_MATCHMAKING_CONFIG: MatchmakingConfig = {
  queueKey: "queue:ranked",
  joinedKey: "queue:ranked:joined",
  maxWaitMs: 60_000,
  tickMs: 1_000,
  toleranceBands: [
    { afterMs: 0, maxDelta: 100 },
    { afterMs: 10_000, maxDelta: 200 },
    { afterMs: 20_000, maxDelta: 300 },
    { afterMs: 30_000, maxDelta: 500 },
  ],
};

export interface QueuedPlayer {
  userId: string;
  rating: number;
  joinedAtMs: number;
}

export interface MatchedPair {
  player1UserId: string;
  player2UserId: string;
  player1Rating: number;
  player2Rating: number;
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
