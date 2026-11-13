import { describe, expect, it } from "vitest";
import type { Card } from "../src/game/types";
import { createGameSessionStore } from "../src/ws/gameSessions";
import { createMessageHandler } from "../src/ws/handlers";
import { createRoundCoordinator } from "../src/ws/roundCoordinator";
import {
  createControllableScheduler,
  ROUND_MS,
  type ControllableScheduler,
} from "../src/ws/timers";
import type { AuthenticatedSocket, ServerMessage } from "../src/ws/types";

function card(id: string, attack: number): Card {
  return {
    ID: id,
    name: id,
    position: "FWD",
    attack,
    defending: 40,
    passing: 40,
  };
}

function deck(prefix: string, attacks: number[]): Card[] {
  return attacks.map((attack, index) => card(`${prefix}-${index}`, attack));
}

function socket(userId: string): AuthenticatedSocket {
  return { userId, isAlive: true } as AuthenticatedSocket;
}

async function setup() {
  const sessions = createGameSessionStore();
  const clock: ControllableScheduler = createControllableScheduler();
  const inbox = new Map<string, ServerMessage[]>();
  const sockets = {
    u1: socket("u1"),
    u2: socket("u2"),
  };

  const send = (target: AuthenticatedSocket, message: ServerMessage) => {
    const list = inbox.get(target.userId) ?? [];
    list.push(message);
    inbox.set(target.userId, list);
  };

  const coordinator = createRoundCoordinator({
    sessions,
    getSocket: (userId) => sockets[userId as "u1" | "u2"],
    send,
    scheduler: clock,
    now: () => clock.now(),
    random: () => 0,
  });

  const handle = createMessageHandler({
    sessions,
    getSocket: (userId) => sockets[userId as "u1" | "u2"],
    send,
    coordinator,
  });

  const session = await sessions.create({
    player1UserId: "u1",
    player2UserId: "u2",
    player1Deck: deck("p1", [90, 80, 70, 60, 50]),
    player2Deck: deck("p2", [10, 20, 30, 40, 45]),
  });
  await coordinator.beginRound(session.id);

  return { sessions, session, clock, inbox, sockets, coordinator, handle };
}

function messages(inbox: Map<string, ServerMessage[]>, userId: string) {
  return inbox.get(userId) ?? [];
}

async function pick(
  ctx: Awaited<ReturnType<typeof setup>>,
  userId: "u1" | "u2",
  cardId: string,
  round: number,
  sequence: number,
) {
  await ctx.handle(ctx.sockets[userId], {
    type: "game:pick",
    gameId: ctx.session.id,
    round,
    sequence,
    cardId,
  });
}

describe("round lifecycle", () => {
  it("resolves immediately when both players pick before the deadline", async () => {
    const ctx = await setup();
    const p1 = ctx.session.state.player1.hand[0].ID;
    const p2 = ctx.session.state.player2.hand[1].ID;
    const opponentBefore = messages(ctx.inbox, "u2").length;

    ctx.clock.elapse(4_000);
    await pick(ctx, "u1", p1, 1, 1);

    expect((await ctx.sessions.get(ctx.session.id))?.state.player1.selectedCardId).toBe(p1);
    expect((await ctx.sessions.get(ctx.session.id))?.state.round).toBe(1);
    expect(messages(ctx.inbox, "u2")).toHaveLength(opponentBefore);
    expect(JSON.stringify(messages(ctx.inbox, "u2"))).not.toContain(p1);

    await pick(ctx, "u2", p2, 1, 1);

    const state = (await ctx.sessions.get(ctx.session.id))?.state;
    expect(state?.round).toBe(2);
    expect(state?.history).toHaveLength(1);
    expect(state?.history[0]?.card1.ID).toBe(p1);
    expect(state?.history[0]?.card2.ID).toBe(p2);
    expect(state?.player1.hand.some((played) => played.ID === p1)).toBe(false);
    expect(state?.player2.hand.some((played) => played.ID === p2)).toBe(false);
    expect(messages(ctx.inbox, "u1").some((message) => message.type === "game:roundResult")).toBe(true);
    expect(messages(ctx.inbox, "u2").some((message) => message.type === "game:roundResult")).toBe(true);
    expect(ctx.clock.pending()).toHaveLength(1);
    expect(ctx.clock.pending()[0]?.dueAt).toBe(4_000 + ROUND_MS);
  });

  it("auto-picks for the idle player when the deadline passes", async () => {
    const ctx = await setup();
    const chosen = ctx.session.state.player1.hand[2].ID;
    const auto = ctx.session.state.player2.hand[0].ID;

    await pick(ctx, "u1", chosen, 1, 1);
    await ctx.clock.advance(ROUND_MS);

    const state = (await ctx.sessions.get(ctx.session.id))?.state;
    expect(state?.round).toBe(2);
    expect(state?.history).toHaveLength(1);
    expect(state?.history[0]?.card1.ID).toBe(chosen);
    expect(state?.history[0]?.card2.ID).toBe(auto);
    expect(state?.player2.hand.some((played) => played.ID === auto)).toBe(false);
    expect(messages(ctx.inbox, "u1").some((message) => message.type === "game:roundResult")).toBe(true);
    expect(messages(ctx.inbox, "u2").some((message) => message.type === "game:roundResult")).toBe(true);
  });

  it("auto-picks for both players when neither picks", async () => {
    const ctx = await setup();
    const auto1 = ctx.session.state.player1.hand[0].ID;
    const auto2 = ctx.session.state.player2.hand[0].ID;

    await ctx.clock.advance(ROUND_MS);

    const state = (await ctx.sessions.get(ctx.session.id))?.state;
    expect(state?.history[0]?.card1.ID).toBe(auto1);
    expect(state?.history[0]?.card2.ID).toBe(auto2);
    expect(state?.round).toBe(2);
    expect(state?.player1.selectedCardId).toBeNull();
    expect(state?.player2.selectedCardId).toBeNull();
  });

  it("lets the deadline win a pick that is processed at the same instant", async () => {
    const ctx = await setup();
    const chosen = ctx.session.state.player1.hand[0].ID;
    const auto = ctx.session.state.player2.hand[0].ID;
    const late = ctx.session.state.player2.hand[1].ID;
    await pick(ctx, "u1", chosen, 1, 1);

    ctx.clock.elapse(ROUND_MS);
    await pick(ctx, "u2", late, 1, 1);
    expect(messages(ctx.inbox, "u2").at(-1)).toEqual({
      type: "error",
      message: "Round deadline has passed",
    });
    expect((await ctx.sessions.get(ctx.session.id))?.state.player2.selectedCardId).toBeNull();

    await ctx.clock.flush();

    const state = (await ctx.sessions.get(ctx.session.id))?.state;
    expect(state?.history).toHaveLength(1);
    expect(state?.history[0]?.card1.ID).toBe(chosen);
    expect(state?.history[0]?.card2.ID).toBe(auto);
    expect(state?.round).toBe(2);

    await ctx.clock.flush();
    expect((await ctx.sessions.get(ctx.session.id))?.state.history).toHaveLength(1);
  });

  it("resolves a last-millisecond completing pick once and ignores the stale timer", async () => {
    const ctx = await setup();
    const firstTimer = ctx.clock.all()[0];
    const p1 = ctx.session.state.player1.hand[0].ID;
    const p2 = ctx.session.state.player2.hand[0].ID;

    ctx.clock.elapse(ROUND_MS - 1);
    await pick(ctx, "u1", p1, 1, 1);
    await pick(ctx, "u2", p2, 1, 1);

    expect((await ctx.sessions.get(ctx.session.id))?.state.history).toHaveLength(1);
    expect((await ctx.sessions.get(ctx.session.id))?.state.round).toBe(2);
    expect(firstTimer?.cancelled).toBe(true);

    await firstTimer?.run();
    ctx.clock.elapse(1);
    await ctx.clock.flush();

    expect((await ctx.sessions.get(ctx.session.id))?.state.history).toHaveLength(1);
    expect((await ctx.sessions.get(ctx.session.id))?.state.round).toBe(2);
    expect(ctx.clock.pending()).toHaveLength(1);
  });

  it("does not let a stale timer cancel the next round", async () => {
    const ctx = await setup();
    const firstTimer = ctx.clock.all()[0];
    await pick(ctx, "u1", ctx.session.state.player1.hand[0].ID, 1, 1);
    await pick(ctx, "u2", ctx.session.state.player2.hand[0].ID, 1, 1);

    await firstTimer?.run();
    expect(ctx.clock.pending()).toHaveLength(1);
    expect((await ctx.sessions.get(ctx.session.id))?.state.round).toBe(2);

    await ctx.clock.advance(ROUND_MS);
    const state = (await ctx.sessions.get(ctx.session.id))?.state;
    expect(state?.history).toHaveLength(2);
    expect(state?.round).toBe(3);
  });

  it("rejects a duplicate or conflicting pick without resolving", async () => {
    const ctx = await setup();
    const first = ctx.session.state.player1.hand[0].ID;
    const second = ctx.session.state.player1.hand[1].ID;

    await pick(ctx, "u1", first, 1, 1);
    await pick(ctx, "u1", second, 1, 1);
    await pick(ctx, "u1", second, 1, 2);

    const state = (await ctx.sessions.get(ctx.session.id))?.state;
    expect(state?.player1.selectedCardId).toBe(first);
    expect(state?.history).toHaveLength(0);
    expect(state?.round).toBe(1);
    expect(messages(ctx.inbox, "u1")).toEqual(
      expect.arrayContaining([
        { type: "error", message: "Duplicate or outdated move" },
        { type: "error", message: "Player has already selected a card" },
      ]),
    );
    expect(messages(ctx.inbox, "u1").some((message) => message.type === "game:roundResult")).toBe(false);
  });

  it("rejects a late pick after the round has already resolved", async () => {
    const ctx = await setup();
    await ctx.clock.advance(ROUND_MS);
    const after = structuredClone((await ctx.sessions.get(ctx.session.id))?.state);

    await pick(ctx, "u1", after?.player1.hand[0].ID ?? "missing", 1, 1);

    expect((await ctx.sessions.get(ctx.session.id))?.state).toEqual(after);
    expect(messages(ctx.inbox, "u1").at(-1)).toMatchObject({ type: "error" });
  });

  it("rejects an invalid card without mutating the game or the timer", async () => {
    const ctx = await setup();
    const before = await ctx.sessions.get(ctx.session.id);
    const pending = ctx.clock.pending().length;

    await pick(ctx, "u1", ctx.session.state.player2.hand[0].ID, 1, 1);
    await pick(ctx, "u1", "not-a-card", 1, 2);

    expect((await ctx.sessions.get(ctx.session.id))?.state).toEqual(before?.state);
    expect((await ctx.sessions.get(ctx.session.id))?.version).toBe(before?.version);
    expect(ctx.clock.pending()).toHaveLength(pending);
    expect(messages(ctx.inbox, "u1").at(-1)).toMatchObject({ type: "error" });
  });

  it("rejects a pick for the wrong round or a game the player is not in", async () => {
    const ctx = await setup();
    const before = structuredClone((await ctx.sessions.get(ctx.session.id))?.state);

    await pick(ctx, "u1", ctx.session.state.player1.hand[0].ID, 4, 1);
    expect(messages(ctx.inbox, "u1").at(-1)).toEqual({
      type: "error",
      message: "Incorrect round number",
    });

    await ctx.handle(socket("stranger"), {
      type: "game:pick",
      gameId: ctx.session.id,
      round: 1,
      sequence: 1,
      cardId: ctx.session.state.player1.hand[0].ID,
    });

    expect((await ctx.sessions.get(ctx.session.id))?.state).toEqual(before);
  });

  it("plays all five rounds and finishes", async () => {
    const ctx = await setup();
    for (let round = 1; round <= 5; round += 1) {
      const state = (await ctx.sessions.get(ctx.session.id))?.state;
      const p1 = state?.player1.hand[0].ID;
      const p2 = state?.player2.hand[0].ID;
      if (!p1 || !p2) throw new Error("expected a card");
      await pick(ctx, "u1", p1, round, round);
      await pick(ctx, "u2", p2, round, round);
    }

    const state = (await ctx.sessions.get(ctx.session.id))?.state;
    expect(state?.status).toBe("finished");
    expect(state?.round).toBe(5);
    expect(state?.history).toHaveLength(5);
    expect(state?.player1.score).toBe(5);
    expect(state?.player2.score).toBe(0);
    expect(state?.player1.hand).toHaveLength(0);
    expect(ctx.clock.pending()).toHaveLength(0);
    expect((await ctx.sessions.get(ctx.session.id))?.deadlineMs).toBeNull();
  });

  it("finishes five idle rounds with distinct automatic cards", async () => {
    const ctx = await setup();
    const p1 = ctx.session.state.player1.hand.map((played) => played.ID);
    const p2 = ctx.session.state.player2.hand.map((played) => played.ID);

    await ctx.clock.advance(ROUND_MS * 5);

    const state = (await ctx.sessions.get(ctx.session.id))?.state;
    expect(state?.status).toBe("finished");
    expect(state?.history.map((round) => round.card1.ID)).toEqual(p1);
    expect(state?.history.map((round) => round.card2.ID)).toEqual(p2);
    expect(new Set(p1).size).toBe(5);
    expect(ctx.clock.pending()).toHaveLength(0);
  });

  it("resolves a round once when two instances time out together", async () => {
    const ctx = await setup();
    const otherClock = createControllableScheduler();
    const otherInbox = new Map<string, ServerMessage[]>();
    const other = createRoundCoordinator({
      sessions: ctx.sessions,
      getSocket: (userId) => socket(userId),
      send: (target, message) => {
        otherInbox.set(target.userId, [
          ...messages(otherInbox, target.userId),
          message,
        ]);
      },
      scheduler: otherClock,
      now: () => otherClock.now(),
      random: () => 0,
    });
    await other.beginRound(ctx.session.id);
    expect(otherClock.pending()).toHaveLength(1);

    await Promise.all([
      ctx.clock.advance(ROUND_MS),
      otherClock.advance(ROUND_MS),
    ]);

    const session = await ctx.sessions.get(ctx.session.id);
    expect(session?.state.round).toBe(2);
    expect(session?.state.history).toHaveLength(1);
    const announced = [
      ...messages(ctx.inbox, "u1"),
      ...messages(otherInbox, "u1"),
    ].filter((message) => message.type === "game:roundResult");
    expect(announced).toHaveLength(1);
  });

  it("re-arms the timer from the stored deadline after a restart", async () => {
    const ctx = await setup();
    ctx.coordinator.dispose();

    const clock = createControllableScheduler(5_000);
    const restarted = createRoundCoordinator({
      sessions: ctx.sessions,
      getSocket: () => undefined,
      send: () => {},
      scheduler: clock,
      now: () => clock.now(),
      random: () => 0,
    });
    const round = await restarted.beginRound(ctx.session.id);

    expect(round?.opened).toBe(false);
    expect(round?.session.deadlineMs).toBe(ROUND_MS);
    expect(clock.pending()).toHaveLength(1);
    expect(clock.pending()[0]?.dueAt).toBe(ROUND_MS);

    await clock.advance(ROUND_MS - 5_000);
    const state = (await ctx.sessions.get(ctx.session.id))?.state;
    expect(state?.round).toBe(2);
    expect(state?.history).toHaveLength(1);
  });

  it("arms a timer when a pick reaches a process that has none", async () => {
    const ctx = await setup();
    ctx.coordinator.dispose();

    const clock = createControllableScheduler(1_000);
    const restarted = createRoundCoordinator({
      sessions: ctx.sessions,
      getSocket: () => undefined,
      send: () => {},
      scheduler: clock,
      now: () => clock.now(),
      random: () => 0,
    });
    const result = await restarted.submitPick({
      gameId: ctx.session.id,
      userId: "u1",
      round: 1,
      sequence: 1,
      cardId: ctx.session.state.player1.hand[0].ID,
    });

    expect(result.status).toBe("waiting");
    expect(clock.pending()[0]?.dueAt).toBe(ROUND_MS);
  });

  it("announces the server deadline when the round opens", async () => {
    const ctx = await setup();
    const start = messages(ctx.inbox, "u1").find(
      (message) => message.type === "game:roundStart",
    );
    expect(start).toMatchObject({
      type: "game:roundStart",
      gameId: ctx.session.id,
      round: 1,
      category: "attack",
      deadlineMs: ROUND_MS,
    });
  });

  it("resolves an idle round from the real server timer", async () => {
    const sessions = createGameSessionStore();
    const session = await sessions.create({
      player1UserId: "u1",
      player2UserId: "u2",
      player1Deck: deck("p1", [90, 80, 70, 60, 50]),
      player2Deck: deck("p2", [10, 20, 30, 40, 45]),
    });
    const coordinator = createRoundCoordinator({
      sessions,
      getSocket: () => undefined,
      send: () => {},
      roundMs: 40,
    });
    await coordinator.beginRound(session.id);

    const started = Date.now();
    while (((await sessions.get(session.id))?.state.history.length ?? 0) < 1) {
      if (Date.now() - started > 1000) {
        throw new Error("real timer did not resolve the round");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    coordinator.dispose();

    expect((await sessions.get(session.id))?.state.history).toHaveLength(1);
    expect((await sessions.get(session.id))?.state.round).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
  });

  it("stops armed timers on dispose", async () => {
    const ctx = await setup();
    ctx.coordinator.dispose();
    await ctx.clock.advance(ROUND_MS * 5);
    expect((await ctx.sessions.get(ctx.session.id))?.state.round).toBe(1);
    expect((await ctx.sessions.get(ctx.session.id))?.state.history).toHaveLength(0);
  });
});
