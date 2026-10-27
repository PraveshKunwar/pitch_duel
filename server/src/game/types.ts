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
