import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Card, Position } from "./types";

export async function loadCards(
  filePath = resolve(__dirname, "data", "players.json"),
): Promise<Card[]> {
  const contents = await readFile(filePath, "utf8");
  const cards: unknown = JSON.parse(contents);
  const unique = new Set<string>();
  const positions = new Set<Position>(["GK", "DEF", "MID", "FWD"]);
  if (!Array.isArray(cards)) {
    throw new Error("Cards must be an array");
  }
  for (const card of cards) {
    if (card.ID.length == 0) {
      throw new Error("ID for this card is empty");
    } else if (unique.has(card.ID)) {
      throw new Error("This player already exists");
    }
    unique.add(card.ID);
    if (card.name.length == 0) {
      throw new Error("Name for this card is empty");
    } else if (!positions.has(card.position)) {
      throw new Error("Position for this card is invalid");
    }
    for (const stat of ["attack", "defending", "passing"] as const) {
      const value = card[stat];
      if (!Number.isInteger(value) || value < 1 || value > 99) {
        throw new Error(`${card.ID} ${stat} must be an integer from 1 to 99`);
      }
    }
  }
  return cards;
}
