import { describe, expect, it, vi } from "vitest";
import type { Card } from "../src/game/types";
import { createGameSessionStore } from "../src/ws/gameSessions";
import { createMessageHandler } from "../src/ws/handlers";
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
  return {
    userId,
    isAlive: true,
  } as AuthenticatedSocket;
}

describe("websocket handlers", () => {
  it("lets a participant join and receive their own state", async () => {
    const sessions = createGameSessionStore();
    const session = sessions.create({
      player1UserId: "u1",
      player2UserId: "u2",
      player1Deck: deck("p1", [90, 80, 70, 60, 50]),
      player2Deck: deck("p2", [10, 20, 30, 40, 45]),
    });

    const sent: ServerMessage[] = [];
    const handle = createMessageHandler({
      sessions,
      getSocket: () => undefined,
      send: (_socket, message) => {
        sent.push(message);
      },
    });

    await handle(socket("u1"), { type: "game:join", gameId: session.id });

    expect(sent[0]).toEqual({ type: "game:joined", gameId: session.id });
    expect(sent[1]?.type).toBe("game:state");
    if (sent[1]?.type === "game:state") {
      expect(sent[1].state.hand).toHaveLength(5);
      expect(sent[1].state.score).toBe(0);
    }
  });

  it("rejects a non-participant join", async () => {
    const sessions = createGameSessionStore();
    const session = sessions.create({
      player1UserId: "u1",
      player2UserId: "u2",
      player1Deck: deck("p1", [90, 80, 70, 60, 50]),
      player2Deck: deck("p2", [10, 20, 30, 40, 45]),
    });

    const sent: ServerMessage[] = [];
    const handle = createMessageHandler({
      sessions,
      getSocket: () => undefined,
      send: (_socket, message) => sent.push(message),
    });

    await handle(socket("stranger"), { type: "game:join", gameId: session.id });
    expect(sent).toEqual([{ type: "error", message: "Not a participant in this game" }]);
  });

  it("rejects a missing game", async () => {
    const sessions = createGameSessionStore();
    const sent: ServerMessage[] = [];
    const handle = createMessageHandler({
      sessions,
      getSocket: () => undefined,
      send: (_socket, message) => sent.push(message),
    });

    await handle(socket("u1"), { type: "game:join", gameId: "missing" });
    expect(sent).toEqual([{ type: "error", message: "Game not found" }]);
  });

  it("rejects a card the player does not own without mutating state", async () => {
    const sessions = createGameSessionStore();
    const session = sessions.create({
      player1UserId: "u1",
      player2UserId: "u2",
      player1Deck: deck("p1", [90, 80, 70, 60, 50]),
      player2Deck: deck("p2", [10, 20, 30, 40, 45]),
    });
    const before = structuredClone(session.state);

    const sent: ServerMessage[] = [];
    const handle = createMessageHandler({
      sessions,
      getSocket: () => undefined,
      send: (_socket, message) => sent.push(message),
    });

    const opponentCard = session.state.player2.hand[0];
    await handle(socket("u1"), {
      type: "game:pick",
      gameId: session.id,
      round: 1,
      sequence: 1,
      cardId: opponentCard.ID,
    });

    expect(sent[0]?.type).toBe("error");
    expect(sessions.get(session.id)?.state).toEqual(before);
  });

  it("rejects an outdated round", async () => {
    const sessions = createGameSessionStore();
    const session = sessions.create({
      player1UserId: "u1",
      player2UserId: "u2",
      player1Deck: deck("p1", [90, 80, 70, 60, 50]),
      player2Deck: deck("p2", [10, 20, 30, 40, 45]),
    });

    const sent: ServerMessage[] = [];
    const handle = createMessageHandler({
      sessions,
      getSocket: () => undefined,
      send: (_socket, message) => sent.push(message),
    });

    await handle(socket("u1"), {
      type: "game:pick",
      gameId: session.id,
      round: 2,
      sequence: 1,
      cardId: session.state.player1.hand[0].ID,
    });

    expect(sent).toEqual([{ type: "error", message: "Incorrect round number" }]);
  });

  it("ignores a duplicate sequence without applying the pick twice", async () => {
    const sessions = createGameSessionStore();
    const session = sessions.create({
      player1UserId: "u1",
      player2UserId: "u2",
      player1Deck: deck("p1", [90, 80, 70, 60, 50]),
      player2Deck: deck("p2", [10, 20, 30, 40, 45]),
    });

    const sent: ServerMessage[] = [];
    const handle = createMessageHandler({
      sessions,
      getSocket: () => undefined,
      send: (_socket, message) => sent.push(message),
    });

    const cardId = session.state.player1.hand[0].ID;
    await handle(socket("u1"), {
      type: "game:pick",
      gameId: session.id,
      round: 1,
      sequence: 1,
      cardId,
    });
    await handle(socket("u1"), {
      type: "game:pick",
      gameId: session.id,
      round: 1,
      sequence: 1,
      cardId: session.state.player1.hand[1].ID,
    });

    expect(sessions.get(session.id)?.state.player1.selectedCardId).toBe(cardId);
    expect(sent.at(-1)).toEqual({
      type: "error",
      message: "Duplicate or outdated move",
    });
  });

  it("resolves the round and notifies both players when both have picked", async () => {
    const sessions = createGameSessionStore();
    const session = sessions.create({
      player1UserId: "u1",
      player2UserId: "u2",
      player1Deck: deck("p1", [90, 80, 70, 60, 50]),
      player2Deck: deck("p2", [10, 20, 30, 40, 45]),
    });

    const inbox = new Map<string, ServerMessage[]>();
    const sockets = {
      u1: socket("u1"),
      u2: socket("u2"),
    };

    const handle = createMessageHandler({
      sessions,
      getSocket: (userId) => sockets[userId as "u1" | "u2"],
      send: (target, message) => {
        const list = inbox.get(target.userId) ?? [];
        list.push(message);
        inbox.set(target.userId, list);
      },
    });

    await handle(sockets.u1, {
      type: "game:pick",
      gameId: session.id,
      round: 1,
      sequence: 1,
      cardId: session.state.player1.hand[0].ID,
    });
    await handle(sockets.u2, {
      type: "game:pick",
      gameId: session.id,
      round: 1,
      sequence: 1,
      cardId: session.state.player2.hand[0].ID,
    });

    const u1 = inbox.get("u1") ?? [];
    const u2 = inbox.get("u2") ?? [];
    expect(u1.some((message) => message.type === "game:roundResult")).toBe(true);
    expect(u2.some((message) => message.type === "game:roundResult")).toBe(true);
    expect(sessions.get(session.id)?.state.round).toBe(2);
    expect(sessions.get(session.id)?.state.player1.score).toBe(1);
  });

  it("does not let a player submit a pick for another seat", async () => {
    const sessions = createGameSessionStore();
    const session = sessions.create({
      player1UserId: "u1",
      player2UserId: "u2",
      player1Deck: deck("p1", [90, 80, 70, 60, 50]),
      player2Deck: deck("p2", [10, 20, 30, 40, 45]),
    });

    const spy = vi.fn();
    const handle = createMessageHandler({
      sessions,
      getSocket: () => undefined,
      send: spy,
    });

    // Identity comes from the socket, not the message body.
    await handle(socket("u2"), {
      type: "game:pick",
      gameId: session.id,
      round: 1,
      sequence: 1,
      cardId: session.state.player1.hand[0].ID,
    });

    expect(sessions.get(session.id)?.state.player1.selectedCardId).toBeNull();
    expect(spy.mock.calls[0][1]).toMatchObject({ type: "error" });
  });
});
