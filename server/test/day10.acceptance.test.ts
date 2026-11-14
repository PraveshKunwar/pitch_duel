import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { findMatchByGameId } from "../src/db/matches";
import { createReconnectService } from "../src/reconnect/service";
import { GRACE_PERIOD_MS } from "../src/reconnect/types";
import { createRedisGameSessionStore } from "../src/redis/gameSessionStore";
import type { GameSessionStore } from "../src/ws/gameSessions";
import { createMatchFinalizer } from "../src/ws/matchFinalizer";
import { setupWebSocket } from "../src/ws/server";
import {
  createControllableScheduler,
  type ControllableScheduler,
} from "../src/ws/timers";
import { createWebSocketTicket } from "../src/ws/tickets";
import { scripted } from "./helpers/cards";
import {
  createTestUser,
  deleteTestUsers,
  ratingOf,
  type TestUser,
} from "./helpers/db";
import { isolatedRedis } from "./helpers/redis";
import { eventually, TestClient } from "./helpers/ws";

const redis = isolatedRedis();
const createdUsers: string[] = [];
const running = new Set<FastifyInstance>();

interface Server {
  app: FastifyInstance;
  sessions: GameSessionStore;
  port: number;
  clock: ControllableScheduler;
  reconnect: ReturnType<typeof createReconnectService>;
  stop(): Promise<void>;
}

async function boot(options?: {
  gracePeriodMs?: number;
}): Promise<Server> {
  const app = Fastify({ logger: false });
  const sessions = createRedisGameSessionStore(redis.client);
  const finalizer = createMatchFinalizer({ sessions });
  const clock = createControllableScheduler(1_000_000);
  let reconnect!: ReturnType<typeof createReconnectService>;

  setupWebSocket(app, {
    sessions,
    finalizer,
    gracePeriodMs: options?.gracePeriodMs,
    createReconnect: ({ getSocket, send, fanout, onMatchEnded, onResumed }) => {
      reconnect = createReconnectService({
        sessions,
        getSocket,
        send,
        fanout,
        onMatchEnded,
        onResumed,
        scheduler: clock,
        now: () => clock.now(),
        config: { gracePeriodMs: options?.gracePeriodMs ?? GRACE_PERIOD_MS },
      });
      return reconnect;
    },
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  running.add(app);
  return {
    app,
    sessions,
    port: address.port,
    clock,
    reconnect,
    async stop() {
      running.delete(app);
      await app.close();
    },
  };
}

async function players(
  rating1 = 1200,
  rating2 = 1000,
): Promise<[TestUser, TestUser]> {
  const pair: [TestUser, TestUser] = [
    await createTestUser(rating1),
    await createTestUser(rating2),
  ];
  createdUsers.push(pair[0].id, pair[1].id);
  return pair;
}

async function connect(server: Server, user: TestUser): Promise<TestClient> {
  const ticket = await createWebSocketTicket(user.id);
  return TestClient.connect(
    `ws://127.0.0.1:${server.port}/ws?ticket=${ticket}`,
  );
}

async function startMatch(
  server: Server,
): Promise<{
  users: [TestUser, TestUser];
  clients: [TestClient, TestClient];
  gameId: string;
}> {
  const users = await players();
  const game = await server.sessions.create({
    player1UserId: users[0].id,
    player2UserId: users[1].id,
    player1Deck: scripted.player1Deck,
    player2Deck: scripted.player2Deck,
  });
  const clients: [TestClient, TestClient] = [
    await connect(server, users[0]),
    await connect(server, users[1]),
  ];
  for (const client of clients) {
    client.send({ type: "game:join", gameId: game.id });
    await client.next("game:joined");
  }
  await clients[0].next("game:roundStart");
  return { users, clients, gameId: game.id };
}

afterEach(async () => {
  for (const app of [...running]) await app.close();
  running.clear();
});

afterAll(async () => {
  await deleteTestUsers(createdUsers);
  await redis.cleanup();
});

describe("day 10 acceptance", () => {
  it("marks a disconnected player and starts a 60s grace deadline", async () => {
    const server = await boot();
    const { clients, gameId } = await startMatch(server);
    const before = server.clock.now();

    clients[0].close();
    await clients[0].waitUntilClosed();

    const paused = await clients[1].next("game:paused");
    const session = await eventually(async () => {
      const current = await server.sessions.get(gameId);
      return current?.frozen ? current : null;
    });

    expect(session.connections.player1.connected).toBe(false);
    expect(session.connections.player1.disconnectedAt).toBe(before);
    expect(session.connections.player1.gracePeriodExpiresAt).toBe(
      before + GRACE_PERIOD_MS,
    );
    expect(paused.gracePeriodExpiresAt).toBe(before + GRACE_PERIOD_MS);
  });

  it("stops accepting picks after a disconnect", async () => {
    const server = await boot();
    const { clients, gameId } = await startMatch(server);

    clients[0].close();
    await clients[0].waitUntilClosed();
    await clients[1].next("game:paused");

    const hand = clients[1].hand;
    clients[1].send({
      type: "game:pick",
      gameId,
      round: 1,
      sequence: 1,
      cardId: hand[0].ID,
    });
    const error = await clients[1].next("error");
    expect(error.message).toMatch(/paused|disconnected/i);

    const session = await server.sessions.get(gameId);
    expect(session?.state.round).toBe(1);
    expect(session?.state.player2.selectedCardId).toBeNull();
  });

  it("reconnects within the grace window and resumes with full private state", async () => {
    const server = await boot();
    const { users, clients, gameId } = await startMatch(server);
    const originalHand = clients[0].hand.map((card) => card.ID);

    clients[0].close();
    await clients[0].waitUntilClosed();
    await clients[1].next("game:paused");

    server.clock.elapse(10_000);

    const again = await connect(server, users[0]);
    again.send({ type: "game:join", gameId });
    await again.next("game:joined");
    const state = await again.next("game:state");

    expect(state.state.hand.map((card) => card.ID)).toEqual(originalHand);
    expect(state.match?.gameId).toBe(gameId);
    expect(state.match?.round).toBe(1);
    expect(state.match?.frozen).toBe(false);
    expect(state.match?.history).toEqual([]);
    // opponent hand must not appear on this player's private state
    expect(JSON.stringify(state)).not.toContain("strong-1");

    await clients[1].next("game:resumed");
    const session = await server.sessions.get(gameId);
    expect(session?.frozen).toBe(false);
    expect(session?.connections.player1.connected).toBe(true);
    expect(session?.connections.player1.gracePeriodExpiresAt).toBeNull();
  });

  it("rejects a reconnect after the grace deadline", async () => {
    const server = await boot({ gracePeriodMs: 1_000 });
    const { users, clients, gameId } = await startMatch(server);

    clients[0].close();
    await clients[0].waitUntilClosed();
    await clients[1].next("game:paused");

    await server.clock.advance(1_000);
    await clients[1].next("game:ended");

    const late = await connect(server, users[0]);
    late.send({ type: "game:join", gameId });
    const error = await late.next("error");
    expect(error.message).toMatch(/ended|expired/i);
  });

  it("forfeits a player who never reconnects and updates ratings", async () => {
    const server = await boot({ gracePeriodMs: 500 });
    const { users, clients, gameId } = await startMatch(server);
    const [rating1, rating2] = await Promise.all([
      ratingOf(users[0].id),
      ratingOf(users[1].id),
    ]);

    clients[0].close();
    await clients[0].waitUntilClosed();
    await clients[1].next("game:paused");

    await server.clock.advance(500);
    const ended = await clients[1].next("game:ended");
    expect(ended).toMatchObject({
      type: "game:ended",
      reason: "forfeit",
      winner: "player2",
    });
    expect(ended.ratings).toEqual({
      player1: expect.any(Number),
      player2: expect.any(Number),
    });

    const match = await eventually(() => findMatchByGameId(gameId));
    expect(match?.status).toBe("finished");
    expect(match?.winner_id).toBe(users[1].id);
    expect(match?.rating_delta).not.toBeNull();

    expect(await ratingOf(users[0].id)).not.toBe(rating1);
    expect(await ratingOf(users[1].id)).not.toBe(rating2);
  });

  it("abandons the match with no rating change when both disconnect", async () => {
    const server = await boot();
    const { users, clients, gameId } = await startMatch(server);
    const [rating1, rating2] = await Promise.all([
      ratingOf(users[0].id),
      ratingOf(users[1].id),
    ]);

    clients[0].close();
    await clients[0].waitUntilClosed();
    await clients[1].next("game:paused");

    clients[1].close();
    await clients[1].waitUntilClosed();

    const session = await eventually(async () => {
      const current = await server.sessions.get(gameId);
      return current?.outcome?.kind === "abandoned" ? current : null;
    });
    expect(session.outcome).toEqual({ kind: "abandoned" });

    const match = await eventually(() => findMatchByGameId(gameId));
    expect(match?.status).toBe("abandoned");
    expect(match?.winner_id).toBeNull();
    expect(match?.rating_delta).toBeNull();
    expect(await ratingOf(users[0].id)).toBe(rating1);
    expect(await ratingOf(users[1].id)).toBe(rating2);
  });

  it("does not let reconnect and expiration both succeed", async () => {
    const server = await boot({ gracePeriodMs: 1_000 });
    const { users, clients, gameId } = await startMatch(server);

    clients[0].close();
    await clients[0].waitUntilClosed();
    await clients[1].next("game:paused");

    server.clock.elapse(999);
    const again = await connect(server, users[0]);
    again.send({ type: "game:join", gameId });
    await again.next("game:joined");
    await again.next("game:state");

    await server.clock.advance(1);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const session = await server.sessions.get(gameId);
    expect(session?.outcome).toBeNull();
    expect(session?.frozen).toBe(false);
    expect(session?.connections.player1.connected).toBe(true);
  });

  it("ignores duplicate expiration once the match is already finished", async () => {
    const server = await boot({ gracePeriodMs: 200 });
    const { users, clients, gameId } = await startMatch(server);

    clients[0].close();
    await clients[0].waitUntilClosed();
    await clients[1].next("game:paused");

    await server.clock.advance(200);
    await clients[1].next("game:ended");
    const first = await eventually(() => findMatchByGameId(gameId));

    await server.clock.advance(200);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = await findMatchByGameId(gameId);
    expect(second?.id).toBe(first?.id);
    expect(await ratingOf(users[1].id)).toBeGreaterThan(1000);
  });

  it("does not disconnect a newer socket when the old one closes", async () => {
    const server = await boot();
    const { users, clients, gameId } = await startMatch(server);

    const replacement = await connect(server, users[0]);
    await clients[0].waitUntilClosed();
    replacement.send({ type: "game:join", gameId });
    await replacement.next("game:joined");

    await new Promise((resolve) => setTimeout(resolve, 50));
    const session = await server.sessions.get(gameId);
    expect(session?.frozen).toBe(false);
    expect(session?.connections.player1.connected).toBe(true);
    expect(session?.connections.player1.gracePeriodExpiresAt).toBeNull();
  });

  it("refuses to resume finished or abandoned games", async () => {
    const server = await boot({ gracePeriodMs: 100 });
    const { users, clients, gameId } = await startMatch(server);

    clients[0].close();
    await clients[0].waitUntilClosed();
    clients[1].close();
    await clients[1].waitUntilClosed();
    await eventually(async () => {
      const current = await server.sessions.get(gameId);
      return current?.outcome?.kind === "abandoned" ? current : null;
    });

    const again = await connect(server, users[0]);
    again.send({ type: "game:join", gameId });
    const error = await again.next("error");
    expect(error.message).toMatch(/ended/i);
  });
});
