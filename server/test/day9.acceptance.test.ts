import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { findUserById } from "../src/db/users";
import { createMatchmakingService } from "../src/matchmaking/service";
import { createRedisGameSessionStore } from "../src/redis/gameSessionStore";
import type { GameSessionStore } from "../src/ws/gameSessions";
import { setupWebSocket } from "../src/ws/server";
import { createWebSocketTicket } from "../src/ws/tickets";
import { scripted } from "./helpers/cards";
import {
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from "./helpers/db";
import { isolatedRedis } from "./helpers/redis";
import { TestClient } from "./helpers/ws";

const redis = isolatedRedis();
const createdUsers: string[] = [];
const running = new Set<FastifyInstance>();

interface Server {
  app: FastifyInstance;
  sessions: GameSessionStore;
  matchmaking: ReturnType<typeof createMatchmakingService>;
  port: number;
  stop(): Promise<void>;
}

async function boot(options?: {
  maxWaitMs?: number;
  tickMs?: number;
  now?: () => number;
}): Promise<Server> {
  const app = Fastify({ logger: false });
  const sessions = createRedisGameSessionStore(redis.client);
  let matchmaking!: ReturnType<typeof createMatchmakingService>;

  setupWebSocket(app, {
    sessions,
    createMatchmaking: ({ getSocket, send, fanout }) => {
      matchmaking = createMatchmakingService({
        redis: redis.client,
        sessions,
        getRating: async (userId) => {
          const user = await findUserById(userId);
          return user ? Number(user.rating) : null;
        },
        getSocket,
        send,
        fanout,
        dealDecks: async () => ({
          player1Deck: scripted.player1Deck,
          player2Deck: scripted.player2Deck,
        }),
        now: options?.now,
        config: {
          maxWaitMs: options?.maxWaitMs ?? 60_000,
          tickMs: options?.tickMs ?? 60_000,
        },
      });
      return matchmaking;
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
    matchmaking,
    port: address.port,
    async stop() {
      running.delete(app);
      await app.close();
    },
  };
}

async function user(rating: number): Promise<TestUser> {
  const created = await createTestUser(rating);
  createdUsers.push(created.id);
  return created;
}

async function connect(server: Server, who: TestUser): Promise<TestClient> {
  const ticket = await createWebSocketTicket(who.id);
  return TestClient.connect(
    `ws://127.0.0.1:${server.port}/ws?ticket=${ticket}`,
  );
}

afterEach(async () => {
  for (const app of [...running]) await app.close();
  running.clear();
  for (const mode of ["classic", "draft", "sudden_death", "tactical"]) {
    const key = `queue:ranked:${mode}`;
    const leftover = await redis.client.zrange(key, 0, -1);
    if (leftover.length > 0) {
      await redis.client.zrem(key, ...leftover);
      await redis.client.hdel(`${key}:joined`, ...leftover);
    }
  }
  await redis.client.del("queue:ranked:membership");
});

afterAll(async () => {
  await deleteTestUsers(createdUsers);
  await redis.cleanup();
});

describe("day 9 acceptance", () => {
  it("matches two similar-rated players into the same game", async () => {
    const server = await boot();
    const [a, b] = [await user(1000), await user(1040)];
    const [c1, c2] = [await connect(server, a), await connect(server, b)];

    c1.send({ type: "matchmaking:join", mode: "classic" });
    await c1.next("matchmaking:queued");

    c2.send({ type: "matchmaking:join", mode: "classic" });
    const [found1, found2] = await Promise.all([
      c1.next("matchmaking:found"),
      c2.next("matchmaking:found"),
    ]);

    expect(found1.gameId).toBe(found2.gameId);
    expect(found1.opponentRating).toBe(1040);
    expect(found2.opponentRating).toBe(1000);

    const session = await server.sessions.get(found1.gameId);
    expect(session).not.toBeNull();
    expect(new Set([session!.player1UserId, session!.player2UserId])).toEqual(
      new Set([a.id, b.id]),
    );
    expect(session!.state.player1.hand).toHaveLength(5);
    expect(session!.state.status).toBe("picking");

    expect(await server.matchmaking.queue.list()).toEqual([]);
    expect(await server.sessions.activeGameFor(a.id)).toBe(found1.gameId);
    expect(await server.sessions.activeGameFor(b.id)).toBe(found1.gameId);

    c1.send({ type: "game:join", gameId: found1.gameId });
    await c1.next("game:joined");
    c2.send({ type: "game:join", gameId: found1.gameId });
    await c2.next("game:joined");

    c1.close();
    c2.close();
    await server.stop();
  });

  it("keeps dissimilar ratings queued until tolerance expands", async () => {
    let now = 1_000_000;
    const server = await boot({ now: () => now, tickMs: 60_000 });
    const [a, b] = [await user(1000), await user(1180)];
    const [c1, c2] = [await connect(server, a), await connect(server, b)];

    c1.send({ type: "matchmaking:join", mode: "classic" });
    await c1.next("matchmaking:queued");
    c2.send({ type: "matchmaking:join", mode: "classic" });
    await c2.next("matchmaking:queued");

    expect(await server.matchmaking.queue.list()).toHaveLength(2);

    now += 15_000;
    await server.matchmaking.tick();

    const [found1, found2] = await Promise.all([
      c1.next("matchmaking:found"),
      c2.next("matchmaking:found"),
    ]);
    expect(found1.gameId).toBe(found2.gameId);
    expect(await server.matchmaking.queue.list()).toEqual([]);

    c1.close();
    c2.close();
    await server.stop();
  });

  it("chooses the closest eligible opponent", async () => {
    const server = await boot();
    const seeker = await user(1000);
    const far = await user(900);
    const close = await user(1010);
    const [cSeeker, cFar, cClose] = [
      await connect(server, seeker),
      await connect(server, far),
      await connect(server, close),
    ];

    cFar.send({ type: "matchmaking:join", mode: "classic" });
    await cFar.next("matchmaking:queued");
    cClose.send({ type: "matchmaking:join", mode: "classic" });
    await cClose.next("matchmaking:queued");
    expect(await server.matchmaking.queue.list()).toHaveLength(2);

    cSeeker.send({ type: "matchmaking:join", mode: "classic" });

    const [foundSeeker, foundClose] = await Promise.all([
      cSeeker.next("matchmaking:found"),
      cClose.next("matchmaking:found"),
    ]);
    expect(foundSeeker.gameId).toBe(foundClose.gameId);
    expect(foundSeeker.opponentRating).toBe(1010);

    const stillQueued = await server.matchmaking.queue.list();
    expect(stillQueued.map((p) => p.userId)).toEqual([far.id]);

    cSeeker.close();
    cFar.close();
    cClose.close();
    await server.stop();
  });

  it("times out a lone searcher and clears redis", async () => {
    let now = 5_000;
    const server = await boot({
      now: () => now,
      maxWaitMs: 60_000,
      tickMs: 60_000,
    });
    const solo = await user(1000);
    const client = await connect(server, solo);

    client.send({ type: "matchmaking:join", mode: "classic" });
    await client.next("matchmaking:queued");
    expect(await server.matchmaking.queue.isQueued(solo.id)).toBe(true);

    now += 60_000;
    await server.matchmaking.tick();
    await client.next("matchmaking:timeout");
    expect(await server.matchmaking.queue.list()).toEqual([]);

    client.close();
    await server.stop();
  });

  it("cancels a queued search", async () => {
    const server = await boot();
    const solo = await user(1000);
    const client = await connect(server, solo);

    client.send({ type: "matchmaking:join", mode: "classic" });
    await client.next("matchmaking:queued");
    client.send({ type: "matchmaking:cancel" });
    await client.next("matchmaking:cancelled");
    expect(await server.matchmaking.queue.list()).toEqual([]);

    client.close();
    await server.stop();
  });

  it("never matches classic against tactical (mode-isolated queues)", async () => {
    const server = await boot({ tickMs: 60_000 });
    const [a, b] = [await user(1000), await user(1000)];
    const [c1, c2] = [await connect(server, a), await connect(server, b)];

    c1.send({ type: "matchmaking:join", mode: "classic" });
    await c1.next("matchmaking:queued");
    c2.send({ type: "matchmaking:join", mode: "tactical" });
    await c2.next("matchmaking:queued");

    await server.matchmaking.tick();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(await server.matchmaking.queues.list("classic")).toHaveLength(1);
    expect(await server.matchmaking.queues.list("tactical")).toHaveLength(1);
    expect(
      c1.received.some((message) => message.type === "matchmaking:found"),
    ).toBe(false);
    expect(
      c2.received.some((message) => message.type === "matchmaking:found"),
    ).toBe(false);

    c1.close();
    c2.close();
    await server.stop();
  });

  it("rejects duplicate queue requests and active-game joins", async () => {
    const server = await boot();
    const [a, b] = [await user(1000), await user(1000)];
    const [c1, c2] = [await connect(server, a), await connect(server, b)];

    c1.send({ type: "matchmaking:join", mode: "classic" });
    await c1.next("matchmaking:queued");
    c1.send({ type: "matchmaking:join", mode: "classic" });
    await expect(c1.next("error")).resolves.toMatchObject({
      message: "Already in matchmaking queue",
    });

    c2.send({ type: "matchmaking:join", mode: "classic" });
    const found = await c1.next("matchmaking:found");
    await c2.next("matchmaking:found");

    c1.send({ type: "matchmaking:join", mode: "classic" });
    await expect(c1.next("error")).resolves.toMatchObject({
      message: "Already in an active game",
    });
    expect(await server.sessions.activeGameFor(a.id)).toBe(found.gameId);

    c1.close();
    c2.close();
    await server.stop();
  });

  it("clears the queue when a waiting client disconnects", async () => {
    const server = await boot();
    const solo = await user(1000);
    const client = await connect(server, solo);

    client.send({ type: "matchmaking:join", mode: "classic" });
    await client.next("matchmaking:queued");
    client.close();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await server.matchmaking.queue.list()).toEqual([]);
    await server.stop();
  });

  it("cannot match the same player twice under concurrent claims", async () => {
    const server = await boot();
    const [a, b, c] = [await user(1000), await user(1000), await user(1000)];

    await server.matchmaking.queue.add(a.id, 1000, 1);
    await server.matchmaking.queue.add(b.id, 1000, 2);
    await server.matchmaking.queue.add(c.id, 1000, 3);

    const [claimB, claimC] = await Promise.all([
      server.matchmaking.queue.claimClosest(b.id, 100),
      server.matchmaking.queue.claimClosest(c.id, 100),
    ]);

    const wins = [claimB, claimC].filter(Boolean);
    expect(wins).toHaveLength(1);
    const claimedIds = new Set(
      wins.flatMap((win) => [win!.seekerId, win!.opponentId]),
    );
    expect(claimedIds.has(a.id)).toBe(true);
    expect(claimedIds.size).toBe(2);

    const remaining = await server.matchmaking.queue.list();
    expect(remaining).toHaveLength(1);
    expect(claimedIds.has(remaining[0].userId)).toBe(false);

    await server.stop();
  });
});
