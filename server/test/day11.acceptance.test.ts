import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { findMatchByGameId } from "../src/db/matches";
import { createRedisGameSessionStore } from "../src/redis/gameSessionStore";
import type { GameSessionStore } from "../src/ws/gameSessions";
import { createMatchFinalizer } from "../src/ws/matchFinalizer";
import { setupWebSocket } from "../src/ws/server";
import { createWebSocketTicket } from "../src/ws/tickets";
import { scripted } from "./helpers/cards";
import {
  createTestUser,
  deleteTestUsers,
  ratingOf,
  type TestUser,
} from "./helpers/db";
import { isolatedRedis } from "./helpers/redis";
import { eventually, playRounds, TestClient } from "./helpers/ws";

const redis = isolatedRedis();
const createdUsers: string[] = [];
const running = new Set<FastifyInstance>();

interface Server {
  app: FastifyInstance;
  sessions: GameSessionStore;
  port: number;
  instanceId: string;
  stop(): Promise<void>;
}

async function boot(instanceId: string): Promise<Server> {
  const app = Fastify({ logger: false });
  const sessions = createRedisGameSessionStore(redis.client);
  const finalizer = createMatchFinalizer({ sessions });

  setupWebSocket(app, {
    sessions,
    finalizer,
    redis: redis.client,
    instanceId,
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
    instanceId,
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

async function crossInstanceMatch(): Promise<{
  serverA: Server;
  serverB: Server;
  users: [TestUser, TestUser];
  clients: [TestClient, TestClient];
  gameId: string;
}> {
  const serverA = await boot("server-a");
  const serverB = await boot("server-b");
  const users = await players();
  const game = await serverA.sessions.create({
    player1UserId: users[0].id,
    player2UserId: users[1].id,
    player1Deck: scripted.player1Deck,
    player2Deck: scripted.player2Deck,
  });

  const clients: [TestClient, TestClient] = [
    await connect(serverA, users[0]),
    await connect(serverB, users[1]),
  ];

  clients[0].send({ type: "game:join", gameId: game.id });
  clients[1].send({ type: "game:join", gameId: game.id });

  await Promise.all([
    clients[0].next("game:joined"),
    clients[1].next("game:joined"),
  ]);
  await Promise.all([
    clients[0].next("game:state"),
    clients[1].next("game:state"),
  ]);
  // Leave game:roundStart in the buffer for playRounds / pick tests.

  return { serverA, serverB, users, clients, gameId: game.id };
}

describe("day 11 — two instances + Redis Pub/Sub", () => {
  afterEach(async () => {
    await Promise.all([...running].map((app) => app.close()));
    running.clear();
  });

  afterAll(async () => {
    await deleteTestUsers(createdUsers);
    await redis.cleanup();
  });

  it("two clients on different instances join the same match", async () => {
    const { serverA, serverB, gameId, clients } = await crossInstanceMatch();
    expect(serverA.instanceId).toBe("server-a");
    expect(serverB.instanceId).toBe("server-b");
    expect(gameId).toBeTruthy();
    expect(clients[0].socket.readyState).toBe(1);
    expect(clients[1].socket.readyState).toBe(1);
    clients[0].close();
    clients[1].close();
    await serverA.stop();
    await serverB.stop();
  });

  it("round resolves exactly once when picks arrive on different instances", async () => {
    const { serverA, serverB, clients, gameId } = await crossInstanceMatch();
    const [p1, p2] = clients;

    await Promise.all([
      p1.next("game:roundStart"),
      p2.next("game:roundStart"),
    ]);

    p1.send({
      type: "game:pick",
      gameId,
      round: 1,
      sequence: 1,
      cardId: p1.hand[0].ID,
    });
    p2.send({
      type: "game:pick",
      gameId,
      round: 1,
      sequence: 1,
      cardId: p2.hand[0].ID,
    });

    const [r1, r2] = await Promise.all([
      p1.next("game:roundResult"),
      p2.next("game:roundResult"),
    ]);
    expect(r1.round.round).toBe(1);
    expect(r2.round.round).toBe(1);
    expect(r1.round).toEqual(r2.round);

    const session = await serverA.sessions.get(gameId);
    expect(session?.state.history).toHaveLength(1);
    expect(session?.state.round).toBe(2);

    p1.close();
    p2.close();
    await serverA.stop();
    await serverB.stop();
  });

  it("simultaneous final picks do not double-resolve", async () => {
    const { serverA, serverB, clients, gameId } = await crossInstanceMatch();
    const [p1, p2] = clients;

    await playRounds(gameId, { client: p1 }, { client: p2 }, 1, 5);

    const session = await eventually(async () => {
      const current = await serverA.sessions.get(gameId);
      return current?.state.status === "finished" ? current : null;
    });
    expect(session.state.history).toHaveLength(5);

    const match = await eventually(() => findMatchByGameId(gameId));
    expect(match.status).toBe("finished");

    p1.close();
    p2.close();
    await serverA.stop();
    await serverB.stop();
  });

  it("duplicate / late picks are rejected after the round advances", async () => {
    const { serverA, serverB, clients, gameId } = await crossInstanceMatch();
    const [p1, p2] = clients;

    await Promise.all([
      p1.next("game:roundStart"),
      p2.next("game:roundStart"),
    ]);

    p1.send({
      type: "game:pick",
      gameId,
      round: 1,
      sequence: 1,
      cardId: p1.hand[0].ID,
    });
    p2.send({
      type: "game:pick",
      gameId,
      round: 1,
      sequence: 1,
      cardId: p2.hand[0].ID,
    });
    await Promise.all([
      p1.next("game:roundResult"),
      p2.next("game:roundResult"),
    ]);
    await Promise.all([
      p1.next("game:roundStart"),
      p2.next("game:roundStart"),
    ]);

    p1.send({
      type: "game:pick",
      gameId,
      round: 1,
      sequence: 1,
      cardId: p1.hand[0].ID,
    });
    const err = await p1.next("error");
    expect(err.message).toMatch(/round|Duplicate|outdated|not accepting/i);

    p1.close();
    p2.close();
    await serverA.stop();
    await serverB.stop();
  });

  it("player 1 disconnect on A leaves player 2 on B functional; reconnect to B restores state", async () => {
    const { serverA, serverB, users, clients, gameId } =
      await crossInstanceMatch();
    const [p1, p2] = clients;

    await Promise.all([
      p1.next("game:roundStart"),
      p2.next("game:roundStart"),
    ]);

    p1.close();
    await p1.waitUntilClosed();
    const paused = await p2.next("game:paused");
    expect(paused.gracePeriodExpiresAt).toBeGreaterThan(Date.now());

    const ticket = await createWebSocketTicket(users[0].id);
    const p1b = await TestClient.connect(
      `ws://127.0.0.1:${serverB.port}/ws?ticket=${ticket}`,
    );
    // Auto-attach on connect because user:{id}:game is set.
    await p1b.next("game:joined");
    const state = await p1b.next("game:state");
    expect(state.match?.gameId).toBe(gameId);
    expect(state.match?.frozen).toBe(false);
    await p2.next("game:resumed");

    p1b.close();
    p2.close();
    await serverA.stop();
    await serverB.stop();
  });

  it("full five-round match across instances persists ratings once", async () => {
    const { serverA, serverB, users, clients, gameId } =
      await crossInstanceMatch();
    const before1 = await ratingOf(users[0].id);
    const before2 = await ratingOf(users[1].id);

    await playRounds(gameId, { client: clients[0] }, { client: clients[1] });

    const match = await eventually(() => findMatchByGameId(gameId));
    expect(match.status).toBe("finished");
    expect(match.rating_delta).not.toBeNull();

    const after1 = await ratingOf(users[0].id);
    const after2 = await ratingOf(users[1].id);
    expect(after1).not.toBe(before1);
    expect(after2).not.toBe(before2);
    expect(Math.abs(after1 - before1)).toBe(Math.abs(after2 - before2));

    clients[0].close();
    clients[1].close();
    await serverA.stop();
    await serverB.stop();
  });
});
