import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { Card } from "../src/game/types";
import { createGameSessionStore } from "../src/ws/gameSessions";
import { setupWebSocket } from "../src/ws/server";
import { ROUND_MS } from "../src/ws/timers";
import { createWebSocketTicket } from "../src/ws/tickets";
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

function deck(prefix: string, attacks: number[]): Card[] {
  return attacks.map((attack, index) => card(`${prefix}-${index}`, attack));
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
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  async nextOfType<T extends ServerMessage["type"]>(
    type: T,
    timeoutMs = 5_000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`timed out waiting for ${type}`);
      }
      const message = await Promise.race([
        this.next(),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`timed out waiting for ${type}`)),
            remaining,
          );
        }),
      ]);
      if (message.type === type) {
        return message as Extract<ServerMessage, { type: T }>;
      }
    }
  }
}

describe("day 7 acceptance", () => {
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

  it(
    "runs a full authenticated match: immediate resolve, 20s auto-pick, finished",
    async () => {
      const startedAt = Date.now();
      const session = await sessions.create({
        player1UserId: "day7-p1",
        player2UserId: "day7-p2",
        player1Deck: deck("p1", [90, 80, 70, 60, 50]),
        player2Deck: deck("p2", [10, 20, 30, 40, 45]),
      });

      const ticket1 = await createWebSocketTicket("day7-p1");
      const ticket2 = await createWebSocketTicket("day7-p2");
      const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket1}`);
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket2}`);
      await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

      const q1 = new MessageQueue(ws1);
      const q2 = new MessageQueue(ws2);

      ws1.send(JSON.stringify({ type: "game:join", gameId: session.id }));
      ws2.send(JSON.stringify({ type: "game:join", gameId: session.id }));

      await expect(q1.nextOfType("game:joined")).resolves.toEqual({
        type: "game:joined",
        gameId: session.id,
      });
      await expect(q2.nextOfType("game:joined")).resolves.toEqual({
        type: "game:joined",
        gameId: session.id,
      });

      const open1 = await q1.nextOfType("game:roundStart");
      const open2 = await q2.nextOfType("game:roundStart");
      expect(open1).toMatchObject({
        type: "game:roundStart",
        gameId: session.id,
        round: 1,
        category: "attack",
      });
      expect(open2.round).toBe(1);
      expect(open1.deadlineMs).toBeGreaterThanOrEqual(startedAt + ROUND_MS);
      expect(open1.deadlineMs).toBeLessThan(startedAt + ROUND_MS + 5_000);

      const round1Before = Date.now();
      const p1Card1 = session.state.player1.hand[0].ID;
      const p2Card1 = session.state.player2.hand[0].ID;
      ws1.send(
        JSON.stringify({
          type: "game:pick",
          gameId: session.id,
          round: 1,
          sequence: 1,
          cardId: p1Card1,
        }),
      );
      await q1.nextOfType("game:state");

      ws2.send(
        JSON.stringify({
          type: "game:pick",
          gameId: session.id,
          round: 1,
          sequence: 1,
          cardId: p2Card1,
        }),
      );

      const r1a = await q1.nextOfType("game:roundResult");
      const r1b = await q2.nextOfType("game:roundResult");
      expect(r1a.round.card1.ID).toBe(p1Card1);
      expect(r1a.round.card2.ID).toBe(p2Card1);
      expect(r1b.round.round).toBe(1);
      expect(Date.now() - round1Before).toBeLessThan(2_000);
      expect((await sessions.get(session.id))?.state.round).toBe(2);

      await q1.nextOfType("game:roundStart");
      await q2.nextOfType("game:roundStart");

      const idleHand = (
        (await sessions.get(session.id))?.state.player2.hand ?? []
      ).map((c) => c.ID);
      const p1Card2 = (await sessions.get(session.id))?.state.player1.hand[0].ID;
      if (!p1Card2) throw new Error("expected p1 card");

      const idleStarted = Date.now();
      ws1.send(
        JSON.stringify({
          type: "game:pick",
          gameId: session.id,
          round: 2,
          sequence: 2,
          cardId: p1Card2,
        }),
      );
      await q1.nextOfType("game:state");

      const r2a = await q1.nextOfType("game:roundResult", ROUND_MS + 5_000);
      const r2b = await q2.nextOfType("game:roundResult", 1_000);
      const idleElapsed = Date.now() - idleStarted;

      expect(idleElapsed).toBeGreaterThanOrEqual(ROUND_MS - 250);
      expect(idleElapsed).toBeLessThan(ROUND_MS + 3_000);
      expect(r2a.round.card1.ID).toBe(p1Card2);
      expect(idleHand).toContain(r2a.round.card2.ID);
      expect(r2b.round.card2.ID).toBe(r2a.round.card2.ID);
      expect((await sessions.get(session.id))?.state.round).toBe(3);

      await q1.nextOfType("game:roundStart");
      await q2.nextOfType("game:roundStart");

      for (let round = 3; round <= 5; round += 1) {
        const state = (await sessions.get(session.id))?.state;
        const c1 = state?.player1.hand[0]?.ID;
        const c2 = state?.player2.hand[0]?.ID;
        if (!c1 || !c2) throw new Error(`missing cards for round ${round}`);

        ws1.send(
          JSON.stringify({
            type: "game:pick",
            gameId: session.id,
            round,
            sequence: round,
            cardId: c1,
          }),
        );
        await q1.nextOfType("game:state");
        ws2.send(
          JSON.stringify({
            type: "game:pick",
            gameId: session.id,
            round,
            sequence: round,
            cardId: c2,
          }),
        );
        await q1.nextOfType("game:roundResult");
        await q2.nextOfType("game:roundResult");

        if (round < 5) {
          await q1.nextOfType("game:roundStart");
          await q2.nextOfType("game:roundStart");
        }
      }

      const ended = await sessions.get(session.id);
      const finished = ended?.state;
      expect(finished?.status).toBe("finished");
      expect(finished?.round).toBe(5);
      expect(finished?.history).toHaveLength(5);
      expect(finished?.player1.hand).toHaveLength(0);
      expect(finished?.player2.hand).toHaveLength(0);
      expect(ended?.deadlineMs).toBeNull();

      ws1.close();
      ws2.close();
    },
    ROUND_MS + 30_000,
  );
});
