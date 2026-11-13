import { CompletedRound, PlayerState, StatCategory } from "../game/types";
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
    };

export type ServerMessage =
  | { type: "game:joined"; gameId: string }
  | { type: "game:state"; state: PlayerState }
  | {
      type: "game:roundStart";
      gameId: string;
      round: number;
      category: StatCategory;
      deadlineMs: number;
    }
  | { type: "game:roundResult"; round: CompletedRound }
  | { type: "error"; message: string };

export interface AuthenticatedSocket extends WebSocket {
  userId: string;
  isAlive: boolean;
}
