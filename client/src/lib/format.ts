import type { Position, StatCategory } from "../types/game";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function categoryLabel(category: StatCategory): string {
  if (category === "defending") return "DEFENSE";
  return category.toUpperCase();
}

export function categoryShort(category: StatCategory): string {
  if (category === "attack") return "ATTACK";
  if (category === "defending") return "DEFENSE";
  return "PASSING";
}

export function positionRole(position: Position): string {
  switch (position) {
    case "GK":
      return "Goalkeeper";
    case "DEF":
      return "Defender";
    case "MID":
      return "Midfielder";
    case "FWD":
      return "Forward";
  }
}

export function overallRating(card: {
  attack: number;
  defending: number;
  passing: number;
}): number {
  return Math.round((card.attack + card.defending + card.passing) / 3);
}

export function formatElo(rating: number | null | undefined): string {
  if (rating == null) return "—";
  return rating.toLocaleString("en-US");
}
