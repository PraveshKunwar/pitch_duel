export type GameMode = "classic" | "draft" | "sudden_death" | "tactical";

export type Tactic =
  | "attacking"
  | "defensive"
  | "possession"
  | "balanced";

export const GAME_MODES: GameMode[] = [
  "classic",
  "draft",
  "sudden_death",
  "tactical",
];

export const MODE_META: Record<
  GameMode,
  { handSize: number; rounds: number }
> = {
  classic: { handSize: 5, rounds: 5 },
  draft: { handSize: 5, rounds: 5 },
  sudden_death: { handSize: 3, rounds: 3 },
  tactical: { handSize: 5, rounds: 5 },
};

export const TACTIC_META: Record<
  Tactic,
  { attack: number; defending: number; passing: number }
> = {
  attacking: { attack: 10, defending: -5, passing: 0 },
  defensive: { attack: 0, defending: 10, passing: -5 },
  possession: { attack: -5, defending: 0, passing: 10 },
  balanced: { attack: 0, defending: 0, passing: 0 },
};

export function clampStat(value: number): number {
  return Math.max(1, Math.min(99, value));
}

export function isGameMode(value: unknown): value is GameMode {
  return (
    value === "classic" ||
    value === "draft" ||
    value === "sudden_death" ||
    value === "tactical"
  );
}
