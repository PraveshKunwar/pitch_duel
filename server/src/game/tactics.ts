import { TACTIC_META, clampStat, type Tactic } from "./modes";
import type { Card } from "./types";

export function applyTactic(card: Card, tactic: Tactic): Card {
  const mod = TACTIC_META[tactic];
  return {
    ...card,
    attack: clampStat(card.attack + mod.attack),
    defending: clampStat(card.defending + mod.defending),
    passing: clampStat(card.passing + mod.passing),
  };
}

export function applyTacticToHand(hand: Card[], tactic: Tactic): Card[] {
  if (tactic === "balanced") return hand.map((c) => ({ ...c }));
  return hand.map((c) => applyTactic(c, tactic));
}
