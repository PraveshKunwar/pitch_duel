import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { Card } from "../src/game/types";
import { createGameSessionStore } from "../src/ws/gameSessions";
import { setupWebSocket } from "../src/ws/server";
import {
  createWebSocketTicket,
  verifyAndConsumeTicket,
} from "../src/ws/tickets";
import type { ServerMessage } from "../src/ws/types";

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

function deck(prefix: string): Card[] {
  return [90, 80, 70, 60, 50].map((attack, index) =>
    card(`${prefix}-${index}`, attack),
  );
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("unexpected-response", (_req, res) => {
      reject(new Error(`unexpected response ${res.statusCode}`));
    });
    socket.once("error", reject);
  });
}

class MessageQueue {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: Array<(message: ServerMessage) => void> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(message);
      } else {
        this.queue.push(message);
      }
    });
  }

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  async nextOfType<T extends ServerMessage["type"]>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (;;) {
      const message = await this.next();
      if (message.type === type) {
        return message as Extract<ServerMessage, { type: T }>;
      }
    }
  }
}

describe("websocket auth integration", () => {
  const app = Fastify({ logger: false });
  const sessions = createGameSessionStore();
  let port = 0;

  beforeAll(async () => {
    setupWebSocket(app, { sessions });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
    port = address.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects missing and invalid tickets", async () => {
    await expect(
      waitForOpen(new WebSocket(`ws://127.0.0.1:${port}/ws`)),
    ).rejects.toThrow(/401|unexpected/);

    await expect(
      waitForOpen(new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=bad`)),
    ).rejects.toThrow(/401|unexpected/);
  });

  it("rejects a reused ticket", async () => {
    const ticket = await createWebSocketTicket("reuse-user");
    await expect(verifyAndConsumeTicket(ticket)).resolves.toEqual({
      userId: "reuse-user",
    });
    await expect(
      waitForOpen(new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`)),
    ).rejects.toThrow(/401|unexpected/);
  });

  it("authenticates from the ticket and supports two players in a game", async () => {
    const startedAt = Date.now();
    const session = await sessions.create({
      player1UserId: "p1",
      player2UserId: "p2",
      player1Deck: deck("a"),
      player2Deck: deck("b"),
    });

    const ticket1 = await createWebSocketTicket("p1");
    const ticket2 = await createWebSocketTicket("p2");
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket1}`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket2}`);
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    const q1 = new MessageQueue(ws1);
    const q2 = new MessageQueue(ws2);

    ws1.send(JSON.stringify({ type: "game:join", gameId: session.id }));
    await expect(q1.next()).resolves.toEqual({
      type: "game:joined",
      gameId: session.id,
    });
    await expect(q1.next()).resolves.toMatchObject({ type: "game:state" });
    const open = await q1.next();
    expect(open).toMatchObject({
      type: "game:roundStart",
      gameId: session.id,
      round: 1,
      category: "attack",
    });
    if (open.type === "game:roundStart") {
      expect(open.deadlineMs).toBeGreaterThanOrEqual(startedAt + 20_000);
      expect(open.deadlineMs).toBeLessThan(startedAt + 25_000);
    }

    ws1.send(JSON.stringify({ type: "not-a-message" }));
    await expect(q1.next()).resolves.toMatchObject({
      type: "error",
      message: "Invalid message format",
    });

    ws1.send("not-json");
    await expect(q1.next()).resolves.toMatchObject({
      type: "error",
      message: "Invalid JSON",
    });

    const card1 = session.state.player1.hand[0].ID;
    const card2 = session.state.player2.hand[0].ID;

    ws1.send(
      JSON.stringify({
        type: "game:pick",
        gameId: session.id,
        round: 1,
        sequence: 1,
        cardId: card1,
      }),
    );
    await expect(q1.next()).resolves.toMatchObject({ type: "game:state" });

    ws2.send(
      JSON.stringify({
        type: "game:pick",
        gameId: session.id,
        round: 1,
        sequence: 1,
        cardId: card2,
      }),
    );

    await expect(q1.nextOfType("game:roundResult")).resolves.toMatchObject({
      type: "game:roundResult",
    });
    await expect(q2.nextOfType("game:roundResult")).resolves.toMatchObject({
      type: "game:roundResult",
    });
    expect((await sessions.get(session.id))?.state.round).toBe(2);

    ws1.close();
    ws2.close();
  });
});
