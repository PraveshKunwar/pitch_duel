export type StatCategory = "attack" | "defending" | "passing";
export type Position = "GK" | "DEF" | "MID" | "FWD";
export type PlayerSeat = "player1" | "player2";

export type GameMode = "classic" | "draft" | "sudden_death" | "tactical";

export type Tactic =
  | "attacking"
  | "defensive"
  | "possession"
  | "balanced";

export interface Card {
  ID: string;
  name: string;
  position: Position;
  attack: number;
  defending: number;
  passing: number;
}

export interface RoundResult {
  winner: PlayerSeat | null;
  decidedBy: "category" | "secondary" | "coinFlip" | "draw";
}

export interface CompletedRound {
  round: number;
  category: StatCategory;
  card1: Card;
  card2: Card;
  result: RoundResult;
}

export interface PlayerState {
  hand: Card[];
  selectedCardId: string | null;
  score: number;
}

export interface GameState {
  round: number;
  category: StatCategory;
  status: "picking" | "finished";
  mode: GameMode;
  /** Regulation rounds before possible sudden death (3 or 5). */
  regulationRounds: number;
  suddenDeath: boolean;
  /** Remaining cards for sudden-death deals. */
  reserve: Card[];
  tactics: { player1: Tactic; player2: Tactic } | null;
  player1: PlayerState;
  player2: PlayerState;
  history: CompletedRound[];
}

export interface DraftState {
  packIndex: number;
  /** Total packs needed so each seat drafts `handSize` cards. */
  totalPacks: number;
  currentPack: Card[];
  /** Picks already taken from the open pack (0 or 1 before burn). */
  picksInPack: number;
  /** Who picks next from the current pack. */
  nextPicker: PlayerSeat;
  /** First picker for the *next* pack (alternates). */
  nextPackFirstPicker: PlayerSeat;
  player1Picks: Card[];
  player2Picks: Card[];
  handSize: number;
}

export type AppScreen =
  | "auth"
  | "lobby"
  | "matchmaking"
  | "mode_select"
  | "draft"
  | "tactics"
  | "game"
  | "leaderboard";

export interface MatchPlayerView {
  userId: string;
  username: string;
  rating: number | null;
  score: number;
}

export type SessionPhase = "drafting" | "choosing_tactic" | "playing";

export interface MatchView {
  gameId: string;
  round: number;
  category: StatCategory;
  status: "picking" | "finished" | "forfeited" | "abandoned";
  mode?: GameMode;
  phase?: SessionPhase;
  suddenDeath?: boolean;
  regulationRounds?: number;
  history: CompletedRound[];
  deadlineMs: number | null;
  frozen: boolean;
  opponentConnected: boolean;
  yourGracePeriodExpiresAt: number | null;
  yourSeat: PlayerSeat;
  you: MatchPlayerView;
  opponent: MatchPlayerView;
  tactics?: { you: Tactic; opponent: Tactic } | null;
}

export interface User {
  id: string;
  email: string;
  username: string;
  rating: number;
}

export interface LeaderboardEntry {
  userId: string;
  username: string | null;
  rating: number;
  rank: number;
}

export type ClientMessage =
  | { type: "game:join"; gameId: string }
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
      winner: PlayerSeat | null;
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

export type ConnectionUiState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "opponent_disconnected"
  | "match_resumed"
  | "opponent_forfeited"
  | "match_abandoned"
  | "match_completed";

export type MatchmakingUiStatus =
  | "idle"
  | "queued"
  | "found"
  | "timeout"
  | "cancelled";
