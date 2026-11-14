import type { GameMode, Tactic } from "./modes";

export type StatCategory = "attack" | "defending" | "passing";

export type Position = "GK" | "DEF" | "MID" | "FWD";

export type PlayerSeat = "player1" | "player2";

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

export interface DraftState {
  packIndex: number;
  totalPacks: number;
  currentPack: Card[];
  picksInPack: number;
  nextPicker: PlayerSeat;
  nextPackFirstPicker: PlayerSeat;
  player1Picks: Card[];
  player2Picks: Card[];
  handSize: number;
}

export interface GameState {
  round: number;
  category: StatCategory;
  status: "picking" | "finished";
  mode: GameMode;
  regulationRounds: number;
  suddenDeath: boolean;
  reserve: Card[];
  tactics: { player1: Tactic; player2: Tactic } | null;
  player1: PlayerState;
  player2: PlayerState;
  history: CompletedRound[];
}
