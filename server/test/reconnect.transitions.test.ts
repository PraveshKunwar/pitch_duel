import { describe, expect, it } from "vitest";
import {
  applyDisconnect,
  applyGraceExpired,
  applyReconnect,
  bindConnection,
} from "../src/reconnect/transitions";
import { GRACE_PERIOD_MS } from "../src/reconnect/types";
import { buildSession } from "../src/ws/gameSessions";
import { flatCard } from "./helpers/cards";

function session() {
  return buildSession({
    player1UserId: "u1",
    player2UserId: "u2",
    player1Deck: [1, 2, 3, 4, 5].map((n) => flatCard(`a${n}`, 50)),
    player2Deck: [1, 2, 3, 4, 5].map((n) => flatCard(`b${n}`, 40)),
    startedAtMs: 1_000,
  });
}

describe("reconnect transitions", () => {
  it("marks a player disconnected and starts a 60s grace period", () => {
    let game = bindConnection(session(), "player1", "c1");
    game = bindConnection(game, "player2", "c2");
    game = { ...game, deadlineMs: 1_000 + 15_000 };

    const result = applyDisconnect(game, "player1", "c1", 1_000, GRACE_PERIOD_MS);
    expect(result.kind).toBe("disconnected");
    if (result.kind !== "disconnected") return;
    expect(result.session.frozen).toBe(true);
    expect(result.session.deadlineMs).toBeNull();
    expect(result.session.pausedRemainingMs).toBe(15_000);
    expect(result.session.connections.player1).toMatchObject({
      connected: false,
      disconnectedAt: 1_000,
      gracePeriodExpiresAt: 1_000 + GRACE_PERIOD_MS,
    });
  });

  it("abandons when the second player also disconnects", () => {
    let game = bindConnection(session(), "player1", "c1");
    game = bindConnection(game, "player2", "c2");
    const first = applyDisconnect(game, "player1", "c1", 1_000, GRACE_PERIOD_MS);
    expect(first.kind).toBe("disconnected");
    if (first.kind !== "disconnected") return;

    const second = applyDisconnect(
      first.session,
      "player2",
      "c2",
      1_500,
      GRACE_PERIOD_MS,
    );
    expect(second.kind).toBe("abandoned");
    if (second.kind !== "abandoned") return;
    expect(second.session.outcome).toEqual({ kind: "abandoned" });
  });

  it("reconnects before the deadline and resumes the timer", () => {
    let game = bindConnection(session(), "player1", "c1");
    game = bindConnection(game, "player2", "c2");
    game = { ...game, deadlineMs: 5_000, pausedRemainingMs: null };
    const disconnected = applyDisconnect(
      game,
      "player1",
      "c1",
      1_000,
      GRACE_PERIOD_MS,
    );
    expect(disconnected.kind).toBe("disconnected");
    if (disconnected.kind !== "disconnected") return;

    const reconnected = applyReconnect(
      disconnected.session,
      "player1",
      "c1b",
      1_000 + 10_000,
    );
    expect(reconnected.kind).toBe("reconnected");
    if (reconnected.kind !== "reconnected") return;
    expect(reconnected.session.frozen).toBe(false);
    expect(reconnected.session.deadlineMs).toBe(1_000 + 10_000 + 4_000);
    expect(reconnected.session.connections.player1.connected).toBe(true);
    expect(reconnected.session.connections.player1.gracePeriodExpiresAt).toBeNull();
  });

  it("rejects reconnect after the grace deadline", () => {
    let game = bindConnection(session(), "player1", "c1");
    game = bindConnection(game, "player2", "c2");
    const disconnected = applyDisconnect(
      game,
      "player1",
      "c1",
      1_000,
      GRACE_PERIOD_MS,
    );
    if (disconnected.kind !== "disconnected") return;

    const late = applyReconnect(
      disconnected.session,
      "player1",
      "late",
      1_000 + GRACE_PERIOD_MS,
    );
    expect(late).toEqual({
      kind: "rejected",
      reason: "Grace period expired",
    });
  });

  it("forfeits when grace expires with the opponent still connected", () => {
    let game = bindConnection(session(), "player1", "c1");
    game = bindConnection(game, "player2", "c2");
    const disconnected = applyDisconnect(
      game,
      "player1",
      "c1",
      1_000,
      GRACE_PERIOD_MS,
    );
    if (disconnected.kind !== "disconnected") return;

    const expired = applyGraceExpired(
      disconnected.session,
      "player1",
      1_000 + GRACE_PERIOD_MS,
    );
    expect(expired.kind).toBe("forfeited");
    if (expired.kind !== "forfeited") return;
    expect(expired.session.outcome).toEqual({
      kind: "forfeit",
      winner: "player2",
      forfeitedBy: "player1",
    });
  });

  it("ignores a stale socket disconnect after a newer connection bound", () => {
    let game = bindConnection(session(), "player1", "c1");
    game = bindConnection(game, "player2", "c2");
    game = bindConnection(game, "player1", "c1-new");

    const stale = applyDisconnect(game, "player1", "c1", 2_000, GRACE_PERIOD_MS);
    expect(stale).toEqual({ kind: "ignored", reason: "Stale connection" });
  });

  it("only one of reconnect vs expiration can win at the deadline", () => {
    let game = bindConnection(session(), "player1", "c1");
    game = bindConnection(game, "player2", "c2");
    const disconnected = applyDisconnect(
      game,
      "player1",
      "c1",
      1_000,
      GRACE_PERIOD_MS,
    );
    if (disconnected.kind !== "disconnected") return;

    const at = 1_000 + GRACE_PERIOD_MS;
    const reconnected = applyReconnect(
      disconnected.session,
      "player1",
      "c1b",
      at - 1,
    );
    expect(reconnected.kind).toBe("reconnected");
    if (reconnected.kind !== "reconnected") return;

    const expired = applyGraceExpired(reconnected.session, "player1", at);
    expect(expired.kind).toBe("ignored");
  });
});
