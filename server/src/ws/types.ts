import type { CompletedRound, PlayerState, StatCategory } from "../game/types";
import type { WebSocket } from "ws";

export type ClientMessage =
  | {
      type: "game:join";
      gameId: string;
    }
  | {
      type: "game:pick";
      gameId: string;
      round: number;
      sequence: number;
      cardId: string;
    }
  | { type: "matchmaking:join" }
  | { type: "matchmaking:cancel" };

export interface MatchView {
  gameId: string;
  round: number;
  category: StatCategory;
  status: "picking" | "finished" | "forfeited" | "abandoned";
  history: CompletedRound[];
  deadlineMs: number | null;
  frozen: boolean;
  opponentConnected: boolean;
  yourGracePeriodExpiresAt: number | null;
}

export type ServerMessage =
  | { type: "game:joined"; gameId: string }
  | { type: "game:state"; state: PlayerState; match?: MatchView }
  | {
      type: "game:roundStart";
      gameId: string;
      round: number;
      category: StatCategory;
      deadlineMs: number;
    }
  | { type: "game:roundResult"; round: CompletedRound }
  | { type: "game:paused"; gracePeriodExpiresAt: number }
  | { type: "game:resumed"; deadlineMs: number | null }
  | {
      type: "game:ended";
      reason: "completed" | "forfeit" | "abandoned";
      winner: "player1" | "player2" | null;
    }
  | {
      type: "matchmaking:queued";
      rating: number;
      queuedAtMs: number;
    }
  | {
      type: "matchmaking:found";
      gameId: string;
      opponentRating: number;
    }
  | { type: "matchmaking:timeout" }
  | { type: "matchmaking:cancelled" }
  | { type: "error"; message: string };

export interface AuthenticatedSocket extends WebSocket {
  userId: string;
  connectionId: string;
  isAlive: boolean;
}
