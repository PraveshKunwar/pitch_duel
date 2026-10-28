export type StatCategory = "attack" | "defending" | "passing";

export type Position = "GK" | "DEF" | "MID" | "FWD";

export interface Card {
  ID: string;
  name: string;
  position: Position;
  attack: number;
  defending: number;
  passing: number;
}

export interface RoundResult {
  winner: "player1" | "player2";
  decidedBy: "category" | "secondary" | "coinFlip";
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
  player1: PlayerState;
  player2: PlayerState;
  history: CompletedRound[];
}
