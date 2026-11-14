import type { GameMode } from "../game/modes";
import type { RankedQueue } from "./queue";
import {
  allowedRatingDelta,
  type MatchmakingConfig,
  type MatchedPair,
  DEFAULT_MATCHMAKING_CONFIG,
} from "./types";

export interface MatchAttempt {
  matched: MatchedPair | null;
  seekerMissing: boolean;
}

export async function findAndClaimOpponent(
  queue: RankedQueue,
  seekerId: string,
  nowMs: number,
  mode: GameMode,
  config: MatchmakingConfig = DEFAULT_MATCHMAKING_CONFIG,
): Promise<MatchAttempt> {
  const seeker = await queue.get(seekerId);
  if (!seeker) {
    return { matched: null, seekerMissing: true };
  }

  const waitMs = Math.max(0, nowMs - seeker.joinedAtMs);
  const maxDelta = allowedRatingDelta(waitMs, config.toleranceBands);
  const claimed = await queue.claimClosest(seekerId, maxDelta);
  if (!claimed) {
    return { matched: null, seekerMissing: false };
  }

  const [player1UserId, player2UserId, player1Rating, player2Rating] =
    claimed.seekerId < claimed.opponentId
      ? [
          claimed.seekerId,
          claimed.opponentId,
          claimed.seekerRating,
          claimed.opponentRating,
        ]
      : [
          claimed.opponentId,
          claimed.seekerId,
          claimed.opponentRating,
          claimed.seekerRating,
        ];

  return {
    matched: {
      player1UserId,
      player2UserId,
      player1Rating,
      player2Rating,
      mode,
    },
    seekerMissing: false,
  };
}
