import { describe, expect, it } from "vitest";
import { safeParseClientMessage } from "../src/ws/schemas";

describe("client message schemas", () => {
  it("accepts valid game:join", () => {
    expect(
      safeParseClientMessage({ type: "game:join", gameId: "g1" }).success,
    ).toBe(true);
  });

  it("accepts valid game:pick", () => {
    expect(
      safeParseClientMessage({
        type: "game:pick",
        gameId: "g1",
        round: 1,
        sequence: 1,
        cardId: "a",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown types", () => {
    expect(safeParseClientMessage({ type: "nope" }).success).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(safeParseClientMessage({ type: "game:join" }).success).toBe(false);
  });

  it("rejects invalid field types", () => {
    expect(
      safeParseClientMessage({
        type: "game:pick",
        gameId: 123,
        round: -5,
        sequence: "hello",
        cardId: null,
      }).success,
    ).toBe(false);
  });
});
