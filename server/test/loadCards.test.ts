import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCards } from "../src/game/loadCards";

function card(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ID: "p-1",
    name: "A",
    position: "FWD",
    attack: 50,
    defending: 50,
    passing: 50,
    ...overrides,
  };
}

async function loadFrom(body: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "load-cards-"));
  const filePath = join(dir, "players.json");
  await writeFile(filePath, JSON.stringify(body));
  try {
    return await loadCards(filePath);
  } finally {
    await rm(dir, { recursive: true });
  }
}

describe("loadCards", () => {
  it("returns every card in the original file", async () => {
    const filePath = resolve(__dirname, "../src/game/data/players.json");
    const expected = JSON.parse(await readFile(filePath, "utf8"));
    await expect(loadCards()).resolves.toEqual(expected);
  });

  it("rejects a duplicate ID", async () => {
    await expect(loadFrom([card({ ID: "same" }), card({ ID: "same", name: "B" })])).rejects.toThrow(
      "This player already exists",
    );
  });

  it("rejects an invalid position", async () => {
    await expect(loadFrom([card({ position: "ST" })])).rejects.toThrow(
      "Position for this card is invalid",
    );
  });

  it("rejects a missing ID", async () => {
    const { ID: _id, ...missingId } = card();
    await expect(loadFrom([missingId])).rejects.toThrow();
  });

  it("rejects a null entry", async () => {
    await expect(loadFrom([null])).rejects.toThrow();
  });

  it("rejects a stat of 100", async () => {
    await expect(loadFrom([card({ attack: 100 })])).rejects.toThrow(
      "p-1 attack must be an integer from 1 to 99",
    );
  });

  it("rejects a top-level JSON object", async () => {
    await expect(loadFrom(card())).rejects.toThrow("Cards must be an array");
  });
});
