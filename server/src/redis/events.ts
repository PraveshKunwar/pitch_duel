import type { StatCategory } from "../game/types";
import type { PlayerSeat } from "../ws/gameSessions";
import type { ServerMessage } from "../ws/types";

/** Events published on `game:{id}:events`. */
export type GameBusEvent =
  | {
      kind: "round_started";
      gameId: string;
      round: number;
      category: StatCategory;
      deadlineMs: number;
      originInstanceId: string;
    }
  | {
      kind: "round_resolved";
      gameId: string;
      finished: boolean;
      originInstanceId: string;
    }
  | {
      kind: "game_paused";
      gameId: string;
      gracePeriodExpiresAt: number;
      disconnectedSeat: PlayerSeat;
      originInstanceId: string;
    }
  | {
      kind: "game_resumed";
      gameId: string;
      deadlineMs: number | null;
      round: number;
      category: StatCategory;
      originInstanceId: string;
    }
  | {
      kind: "game_ended";
      gameId: string;
      reason: "completed" | "forfeit" | "abandoned";
      winner: PlayerSeat | null;
      ratings?: { player1: number; player2: number };
      ratingDelta?: number | null;
      originInstanceId: string;
    };

/** Events published on `user:{id}:events`. */
export type UserBusEvent = {
  kind: "deliver";
  message: ServerMessage;
  originInstanceId: string;
};

export function parseGameBusEvent(raw: string): GameBusEvent | null {
  try {
    const parsed = JSON.parse(raw) as GameBusEvent;
    if (!parsed || typeof parsed !== "object" || !("kind" in parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseUserBusEvent(raw: string): UserBusEvent | null {
  try {
    const parsed = JSON.parse(raw) as UserBusEvent;
    if (!parsed || parsed.kind !== "deliver" || !parsed.message) return null;
    return parsed;
  } catch {
    return null;
  }
}
