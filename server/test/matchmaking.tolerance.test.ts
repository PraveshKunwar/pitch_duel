import { describe, expect, it } from "vitest";
import { allowedRatingDelta } from "../src/matchmaking/types";

describe("allowedRatingDelta", () => {
  it("expands tolerance as wait time grows", () => {
    expect(allowedRatingDelta(0)).toBe(100);
    expect(allowedRatingDelta(9_999)).toBe(100);
    expect(allowedRatingDelta(10_000)).toBe(200);
    expect(allowedRatingDelta(20_000)).toBe(300);
    expect(allowedRatingDelta(30_000)).toBe(500);
    expect(allowedRatingDelta(90_000)).toBe(500);
  });
});
