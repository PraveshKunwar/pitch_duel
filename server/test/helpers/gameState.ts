import type { GameState } from "../../src/game/types";

/** Fill mode fields so older fixtures stay valid. */
export function withClassicMode(
  state: Omit<
    GameState,
    "mode" | "regulationRounds" | "suddenDeath" | "reserve" | "tactics"
  > &
    Partial<
      Pick<
        GameState,
        "mode" | "regulationRounds" | "suddenDeath" | "reserve" | "tactics"
      >
    >,
): GameState {
  return {
    mode: "classic",
    regulationRounds: 5,
    suddenDeath: false,
    reserve: [],
    tactics: null,
    ...state,
  };
}
