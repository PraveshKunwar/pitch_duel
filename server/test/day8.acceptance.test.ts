import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  findMatchByGameId,
  findMatchRounds,
  recordFinishedMatch,
  type FinishedMatch,
  type RecordedMatch,
} from "../src/db/matches";
import { createRedisGameSessionStore } from "../src/redis/gameSessionStore";
import type { GameSessionStore } from "../src/ws/gameSessions";
import { createMatchFinalizer } from "../src/ws/matchFinalizer";
import { setupWebSocket } from "../src/ws/server";
import { createWebSocketTicket } from "../src/ws/tickets";
import { scripted } from "./helpers/cards";
import {
  createTestUser,
  deleteTestUsers,
  faultyPool,
  matchCountFor,
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
  stop(): Promise<void>;
}

async function boot(
  recordMatch?: (match: FinishedMatch) => Promise<RecordedMatch>,
): Promise<Server> {
  const app = Fastify({ logger: false });
  const sessions = createRedisGameSessionStore(redis.client);
  const finalizer = createMatchFinalizer({ sessions, recordMatch });
  setupWebSocket(app, { sessions, finalizer });
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

async function joinBoth(
  server: Server,
  gameId: string,
  users: [TestUser, TestUser],
): Promise<[TestClient, TestClient]> {
  const clients: [TestClient, TestClient] = [
    await connect(server, users[0]),
    await connect(server, users[1]),
  ];
  for (const client of clients) {
    client.send({ type: "game:join", gameId });
    await client.next("game:joined");
  }
  return clients;
}

function newGame(server: Server, [p1, p2]: [TestUser, TestUser]) {
  return server.sessions.create({
    player1UserId: p1.id,
    player2UserId: p2.id,
    player1Deck: scripted.player1Deck,
    player2Deck: scripted.player2Deck,
  });
}

afterEach(async () => {
  for (const app of running) await app.close();
  running.clear();
});

afterAll(async () => {
  await deleteTestUsers(createdUsers);
  await redis.cleanup();
});

describe("day 8 acceptance", () => {
  it("saves a completed match, its five rounds, and both ratings", async () => {
    const server = await boot();
    const users = await players(1200, 1000);
    const [p1, p2] = users;
    const game = await newGame(server, users);
    const [c1, c2] = await joinBoth(server, game.id, users);
    const startedAt = Date.now();

    const results = await playRounds(
      game.id,
      { client: c1 },
      { client: c2, pick: scripted.player2Pick },
    );
    const match = await eventually(() => findMatchByGameId(game.id));

    expect(match).toMatchObject({
      game_id: game.id,
      player1_id: p1.id,
      player2_id: p2.id,
      winner_id: p1.id,
      rating_delta: 8,
      status: "finished",
    });
    expect(match.started_at.getTime()).toBeGreaterThanOrEqual(
      startedAt - 5_000,
    );
    expect(match.ended_at?.getTime()).toBeGreaterThanOrEqual(
      match.started_at.getTime(),
    );
    expect(match.ended_at?.getTime()).toBeLessThanOrEqual(Date.now());

    const rounds = await findMatchRounds(match.id);
    expect(rounds).toHaveLength(5);
    expect(rounds).toEqual(
      results.map(({ round }, index) => ({
        match_id: match.id,
        round_no: index + 1,
        stat: scripted.roundStats[index],
        card1_id: round.card1.ID,
        card2_id: round.card2.ID,
        winner_id: scripted.roundWinners[index] === "player1" ? p1.id : p2.id,
      })),
    );
    expect(rounds.map((round) => round.card2_id.split("-")[0])).toEqual([
      "weak",
      "strong",
      "weak",
      "strong",
      "weak",
    ]);

    expect(await ratingOf(p1.id)).toBe(1208);
    expect(await ratingOf(p2.id)).toBe(992);

    await eventually(async () =>
      (await server.sessions.activeGameFor(p1.id)) === null ? true : null,
    );
    expect(await server.sessions.unpersisted()).not.toContain(game.id);
    expect(await server.sessions.activeGameFor(p2.id)).toBeNull();
  });

  it("keeps finished matches and ratings across a restart", async () => {
    const first = await boot();
    const users = await players(1200, 1000);
    const [p1, p2] = users;
    const game = await newGame(first, users);
    const [c1, c2] = await joinBoth(first, game.id, users);
    await playRounds(
      game.id,
      { client: c1 },
      { client: c2, pick: scripted.player2Pick },
    );
    const before = await eventually(() => findMatchByGameId(game.id));
    const roundsBefore = await findMatchRounds(before.id);

    await first.stop();
    const second = await boot();

    expect(await findMatchByGameId(game.id)).toEqual(before);
    expect(await findMatchRounds(before.id)).toEqual(roundsBefore);
    expect(await ratingOf(p1.id)).toBe(1208);
    expect(await ratingOf(p2.id)).toBe(992);
    await second.stop();
    await boot();
    expect(await ratingOf(p1.id)).toBe(1208);
    expect(await ratingOf(p2.id)).toBe(992);
    expect(await matchCountFor(p1.id)).toBe(1);
  });

  it("writes nothing when the database fails at match end, then recovers on restart", async () => {
    const failing = faultyPool(({ sql }) => {
      if (sql.includes("INSERT INTO match_rounds")) {
        throw new Error("injected database failure");
      }
    });
    let failedAttempts = 0;
    const broken = await boot(async (match) => {
      try {
        return await recordFinishedMatch(match, failing);
      } catch (error) {
        failedAttempts += 1;
        throw error;
      }
    });
    const users = await players(1200, 1000);
    const [p1, p2] = users;
    const game = await newGame(broken, users);
    const [c1, c2] = await joinBoth(broken, game.id, users);

    const results = await playRounds(
      game.id,
      { client: c1 },
      { client: c2, pick: scripted.player2Pick },
    );
    await eventually(async () => (failedAttempts > 0 ? true : null));
    expect(failedAttempts).toBe(1);

    expect(results).toHaveLength(5);
    expect(await findMatchByGameId(game.id)).toBeNull();
    expect(await ratingOf(p1.id)).toBe(1200);
    expect(await ratingOf(p2.id)).toBe(1000);
    expect(await matchCountFor(p1.id)).toBe(0);
    expect(await broken.sessions.unpersisted()).toContain(game.id);
    expect((await broken.sessions.get(game.id))?.state.status).toBe("finished");
    expect(await broken.sessions.activeGameFor(p1.id)).toBe(game.id);

    await broken.stop();
    const healthy = await boot();

    const match = await findMatchByGameId(game.id);
    expect(match).toMatchObject({ winner_id: p1.id, rating_delta: 8 });
    expect(await findMatchRounds(match?.id ?? "")).toHaveLength(5);
    expect(await ratingOf(p1.id)).toBe(1208);
    expect(await ratingOf(p2.id)).toBe(992);
    expect(await healthy.sessions.unpersisted()).not.toContain(game.id);
    expect(await healthy.sessions.activeGameFor(p1.id)).toBeNull();

    await healthy.stop();
    await boot();
    expect(await ratingOf(p1.id)).toBe(1208);
    expect(await matchCountFor(p1.id)).toBe(1);
  });

  it("finishes Redis cleanup on restart if the server died right after the commit", async () => {
    let committed = 0;
    const dying = await boot(async (match) => {
      await recordFinishedMatch(match);
      committed += 1;
      throw new Error("process died after COMMIT");
    });
    const users = await players(1200, 1000);
    const [p1, p2] = users;
    const game = await newGame(dying, users);
    const [c1, c2] = await joinBoth(dying, game.id, users);
    await playRounds(
      game.id,
      { client: c1 },
      { client: c2, pick: scripted.player2Pick },
    );
    await eventually(async () => (committed > 0 ? true : null));

    expect(await ratingOf(p1.id)).toBe(1208);
    expect(await dying.sessions.unpersisted()).toContain(game.id);
    expect(await dying.sessions.activeGameFor(p1.id)).toBe(game.id);

    await dying.stop();
    const restarted = await boot();

    expect(await restarted.sessions.unpersisted()).not.toContain(game.id);
    expect(await restarted.sessions.activeGameFor(p1.id)).toBeNull();
    expect(await restarted.sessions.activeGameFor(p2.id)).toBeNull();
    expect(await ratingOf(p1.id)).toBe(1208);
    expect(await ratingOf(p2.id)).toBe(992);
    expect(await matchCountFor(p1.id)).toBe(1);
  });

  it("resumes a live game from Redis after a restart and still saves it", async () => {
    const first = await boot();
    const users = await players(1200, 1000);
    const [p1, p2] = users;
    const game = await newGame(first, users);
    const [c1, c2] = await joinBoth(first, game.id, users);
    await playRounds(
      game.id,
      { client: c1 },
      { client: c2, pick: scripted.player2Pick },
      1,
      2,
    );
    const round3 = await c1.next("game:roundStart");
    const pickedCard = c1.hand[0].ID;
    c1.send({
      type: "game:pick",
      gameId: game.id,
      round: 3,
      sequence: 3,
      cardId: pickedCard,
    });
    await c1.next("game:state");

    await first.stop();
    const second = await boot();
    const [r1, r2] = await joinBoth(second, game.id, users);

    const state1 = await r1.next("game:state");
    const state2 = await r2.next("game:state");
    expect(state1.state.score).toBe(1);
    expect(state2.state.score).toBe(1);
    expect(state1.state.hand).toHaveLength(3);
    expect(state1.state.selectedCardId).toBe(pickedCard);
    expect(state2.state.selectedCardId).toBeNull();
    expect(JSON.stringify(r2.received)).not.toContain(pickedCard);
    for (const client of [r1, r2]) {
      const resumed = await client.next("game:roundStart");
      expect(resumed.round).toBe(3);
      expect(resumed.deadlineMs).toBe(round3.deadlineMs);
    }
    r1.send({
      type: "game:pick",
      gameId: game.id,
      round: 3,
      sequence: 3,
      cardId: pickedCard,
    });
    await expect(r1.next("error")).resolves.toMatchObject({
      message: "Duplicate or outdated move",
    });

    r2.send({
      type: "game:pick",
      gameId: game.id,
      round: 3,
      sequence: 3,
      cardId: scripted.player2Pick(3, r2.hand),
    });
    await Promise.all([
      r1.next("game:roundResult"),
      r2.next("game:roundResult"),
    ]);
    await playRounds(
      game.id,
      { client: r1 },
      { client: r2, pick: scripted.player2Pick },
      4,
      5,
    );

    const match = await eventually(() => findMatchByGameId(game.id));
    expect(match.winner_id).toBe(p1.id);
    expect(await findMatchRounds(match.id)).toHaveLength(5);
    expect(await ratingOf(p1.id)).toBe(1208);
    expect(await ratingOf(p2.id)).toBe(992);
  });
});
