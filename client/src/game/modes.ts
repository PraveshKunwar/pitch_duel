import type { GameMode, Tactic } from "../types/game";

export const MODE_META: Record<
  GameMode,
  { title: string; tagline: string; twist: string; handSize: number; rounds: number }
> = {
  classic: {
    title: "Classic Duel",
    tagline: "Five cards. Five rounds. One winner.",
    twist: "The standard ranked ruleset, practice vs CPU.",
    handSize: 5,
    rounds: 5,
  },
  draft: {
    title: "Draft Battle",
    tagline: "Build your team from shared packs.",
    twist: "Take the 95 ATK striker — or deny the 90 DEF wall?",
    handSize: 5,
    rounds: 5,
  },
  sudden_death: {
    title: "Sudden Death",
    tagline: "Three cards. High pressure. No mercy.",
    twist: "Tied after three? First round win ends it.",
    handSize: 3,
    rounds: 3,
  },
  tactical: {
    title: "Tactical Battle",
    tagline: "Lock a formation before kickoff.",
    twist: "Predict their approach — or get punished.",
    handSize: 5,
    rounds: 5,
  },
};

export const TACTIC_META: Record<
  Tactic,
  {
    title: string;
    description: string;
    attack: number;
    defending: number;
    passing: number;
  }
> = {
  attacking: {
    title: "Attacking",
    description: "+10 attack, −5 defense",
    attack: 10,
    defending: -5,
    passing: 0,
  },
  defensive: {
    title: "Defensive",
    description: "+10 defense, −5 passing",
    attack: 0,
    defending: 10,
    passing: -5,
  },
  possession: {
    title: "Possession",
    description: "+10 passing, −5 attack",
    attack: -5,
    defending: 0,
    passing: 10,
  },
  balanced: {
    title: "Balanced",
    description: "No modifiers",
    attack: 0,
    defending: 0,
    passing: 0,
  },
};

export function clampStat(value: number): number {
  return Math.max(1, Math.min(99, value));
}
