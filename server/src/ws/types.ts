import type { GameMode, Tactic } from "../game/modes";
import type {
  Card,
  CompletedRound,
  DraftState,
  PlayerState,
  StatCategory,
} from "../game/types";
import type { WebSocket } from "ws";
import type { SessionPhase } from "./gameSessions";

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
  | {
      type: "game:draftPick";
      gameId: string;
      sequence: number;
      cardId: string;
    }
  | {
      type: "game:chooseTactic";
      gameId: string;
      sequence: number;
      tactic: Tactic;
    }
  | { type: "matchmaking:join"; mode: GameMode }
  | { type: "matchmaking:cancel" };

export interface MatchPlayerView {
  userId: string;
  username: string;
  rating: number | null;
  score: number;
}

export interface MatchView {
  gameId: string;
  round: number;
  category: StatCategory;
  status: "picking" | "finished" | "forfeited" | "abandoned";
  mode: GameMode;
  phase: SessionPhase;
  suddenDeath: boolean;
  regulationRounds: number;
  history: CompletedRound[];
  deadlineMs: number | null;
  frozen: boolean;
  opponentConnected: boolean;
  yourGracePeriodExpiresAt: number | null;
  yourSeat: "player1" | "player2";
  you: MatchPlayerView;
  opponent: MatchPlayerView;
  tactics: { you: Tactic; opponent: Tactic } | null;
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
      type: "game:draftState";
      gameId: string;
      draft: DraftState;
      yourPicks: Card[];
      opponentPickCount: number;
    }
  | {
      type: "game:tacticState";
      gameId: string;
      you: Tactic | null;
      opponentReady: boolean;
    }
  | {
      type: "matchmaking:queued";
      rating: number;
      queuedAtMs: number;
      mode: GameMode;
    }
  | {
      type: "matchmaking:found";
      gameId: string;
      opponentRating: number;
      opponentUsername: string;
      mode: GameMode;
    }
  | { type: "matchmaking:timeout" }
  | { type: "matchmaking:cancelled" }
  | { type: "error"; message: string };

export interface AuthenticatedSocket extends WebSocket {
  userId: string;
  connectionId: string;
  isAlive: boolean;
}
