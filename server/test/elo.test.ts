import { describe, expect, it } from "vitest";
import { applyElo, ELO_K, eloDelta, expectedScore } from "../src/game/elo";

describe("elo", () => {
  it("expects an even match between equal ratings", () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
  });

  it("gives both players' expectations a total of 1", () => {
    expect(expectedScore(1200, 1000) + expectedScore(1000, 1200)).toBeCloseTo(
      1,
    );
  });

  it("puts a 400-point favourite at ten to one", () => {
    expect(expectedScore(1400, 1000)).toBeCloseTo(10 / 11);
  });

  it("uses K = 32", () => {
    expect(ELO_K).toBe(32);
  });

  it("moves equal players by half of K", () => {
    expect(eloDelta(1000, 1000)).toBe(16);
  });

  it("rewards an upset more than an expected win", () => {
    expect(eloDelta(1000, 1400)).toBe(29);
    expect(eloDelta(1400, 1000)).toBe(3);
  });

  it("can round to no change when the favourite is far ahead", () => {
    expect(eloDelta(2000, 1000)).toBe(0);
  });

  it("is zero-sum: the loser drops exactly what the winner gains", () => {
    for (const [winner, loser] of [
      [1000, 1000],
      [1200, 1000],
      [987, 1513],
      [1513, 987],
    ]) {
      const result = applyElo(winner, loser);
      expect(result.winnerRating).toBe(winner + result.delta);
      expect(result.loserRating).toBe(loser - result.delta);
      expect(result.winnerRating + result.loserRating).toBe(winner + loser);
      expect(result.delta).toBeGreaterThanOrEqual(0);
      expect(result.delta).toBeLessThanOrEqual(ELO_K);
    }
  });

  it("applies the worked example used by the persistence tests", () => {
    expect(applyElo(1200, 1000)).toEqual({
      delta: 8,
      winnerRating: 1208,
      loserRating: 992,
    });
  });
});
