import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import {
  findMatchByGameId,
  recordFinishedMatch,
  type FinishedMatch,
} from "../src/db/matches";
import { applyElo } from "../src/game/elo";
import { leaderboardRoutes } from "../src/http/leaderboard";
import { createLeaderboardService } from "../src/leaderboard/leaderboard";
import { LEADERBOARD_KEY } from "../src/leaderboard/types";
import { createRedisGameSessionStore } from "../src/redis/gameSessionStore";
import { createMatchFinalizer } from "../src/ws/matchFinalizer";
import {
  createTestUser,
  deleteTestUsers,
  ratingOf,
  type TestUser,
} from "./helpers/db";
import { flatCard } from "./helpers/cards";
import { isolatedRedis } from "./helpers/redis";

const redis = isolatedRedis();
const leaderboard = createLeaderboardService(redis.client, LEADERBOARD_KEY);
const sessions = createRedisGameSessionStore(redis.client);
const created: string[] = [];
const leaderboardErrors: unknown[] = [];

const finalizer = createMatchFinalizer({
  sessions,
  leaderboard,
  onLeaderboardError: (error) => {
    leaderboardErrors.push(error);
  },
});

const app = Fastify({ logger: false });
app.register(leaderboardRoutes(leaderboard));

async function user(rating = 1000): Promise<TestUser> {
  const made = await createTestUser(rating);
  created.push(made.id);
  return made;
}

function finishedMatch(
  player1: TestUser,
  player2: TestUser,
  winner: "player1" | "player2" = "player1",
): FinishedMatch {
  const stats = [
    "attack",
    "defending",
    "passing",
    "attack",
    "defending",
  ] as const;
  return {
    gameId: randomUUID(),
    player1Id: player1.id,
    player2Id: player2.id,
    winner,
    startedAt: new Date("2026-11-12T20:00:00.000Z"),
    endedAt: new Date("2026-11-12T20:05:00.000Z"),
    rounds: stats.map((stat, index) => ({
      roundNo: index + 1,
      stat,
      card1Id: `p1-card-${index + 1}`,
      card2Id: `p2-card-${index + 1}`,
      winner: index % 2 === 0 ? "player1" : "player2",
    })),
  };
}

afterAll(async () => {
  await app.close();
  await deleteTestUsers(created);
  await redis.cleanup();
});

describe("Day 12 leaderboard acceptance", () => {
  it("persists Elo in Postgres then mirrors ratings into the Redis sorted set", async () => {
    const p1 = await user(1400);
    const p2 = await user(1200);
    const expected = applyElo(1400, 1200);
    const match = finishedMatch(p1, p2, "player1");

    const recorded = await recordFinishedMatch(match);
    await leaderboard.updateLeaderboardEntries([
      { userId: p1.id, rating: recorded.ratings.player1 },
      { userId: p2.id, rating: recorded.ratings.player2 },
    ]);

    expect(await findMatchByGameId(match.gameId)).not.toBeNull();
    expect(await ratingOf(p1.id)).toBe(expected.winnerRating);
    expect(await ratingOf(p2.id)).toBe(expected.loserRating);
    expect(await leaderboard.getPlayerRating(p1.id)).toBe(
      expected.winnerRating,
    );
    expect(await leaderboard.getPlayerRating(p2.id)).toBe(
      expected.loserRating,
    );

    const p1Rank = await leaderboard.getPlayerRank(p1.id);
    const p2Rank = await leaderboard.getPlayerRank(p2.id);
    expect(p1Rank).not.toBeNull();
    expect(p2Rank).not.toBeNull();
    expect(p1Rank!).toBeLessThan(p2Rank!);
  });

  it("finalizer updates Redis after a forfeit commits to Postgres", async () => {
    const p1 = await user(1300);
    const p2 = await user(1250);
    const expected = applyElo(1300, 1250);

    const session = await sessions.create({
      player1UserId: p1.id,
      player2UserId: p2.id,
      player1Deck: [1, 2, 3, 4, 5].map((n) => flatCard(`a${n}`, 60)),
      player2Deck: [1, 2, 3, 4, 5].map((n) => flatCard(`b${n}`, 40)),
    });
    const forfeited = await sessions.update({
      ...session,
      state: { ...session.state, status: "finished" },
      outcome: {
        kind: "forfeit",
        winner: "player1",
        forfeitedBy: "player2",
      },
      endedAtMs: Date.now(),
    });
    if (!forfeited) throw new Error("failed to mark forfeit");

    const recorded = await finalizer.finalize(forfeited);
    expect(recorded.status).toBe("finished");
    expect(await findMatchByGameId(session.id)).not.toBeNull();
    expect(await ratingOf(p1.id)).toBe(expected.winnerRating);
    expect(await ratingOf(p2.id)).toBe(expected.loserRating);
    expect(await leaderboard.getPlayerRating(p1.id)).toBe(
      expected.winnerRating,
    );
    expect(await leaderboard.getPlayerRating(p2.id)).toBe(
      expected.loserRating,
    );
  });

  it("GET /leaderboard returns Redis order with Postgres usernames", async () => {
    await app.ready();
    const high = await user(1600);
    const low = await user(1100);
    await leaderboard.updateLeaderboardEntries([
      { userId: high.id, rating: 1600 },
      { userId: low.id, rating: 1100 },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/leaderboard?limit=100",
    });
    expect(res.statusCode).toBe(200);
    const players = (
      res.json() as {
        players: Array<{
          userId: string;
          username: string;
          rating: number;
          rank: number;
        }>;
      }
    ).players;

    const highEntry = players.find((p) => p.userId === high.id);
    const lowEntry = players.find((p) => p.userId === low.id);
    expect(highEntry).toMatchObject({
      username: high.username,
      rating: 1600,
    });
    expect(lowEntry).toMatchObject({
      username: low.username,
      rating: 1100,
    });
    expect(highEntry!.rank).toBeLessThan(lowEntry!.rank);
  });

  it("rebuilds the leaderboard from Postgres after Redis is wiped", async () => {
    const a = await user(1550);
    const b = await user(1450);
    await leaderboard.updateLeaderboardEntries([
      { userId: a.id, rating: 1550 },
      { userId: b.id, rating: 1450 },
    ]);

    await redis.client.del(LEADERBOARD_KEY);
    expect(await leaderboard.count()).toBe(0);

    await leaderboard.rebuildLeaderboard();

    expect(await leaderboard.getPlayerRating(a.id)).toBe(
      await ratingOf(a.id),
    );
    expect(await leaderboard.getPlayerRating(b.id)).toBe(
      await ratingOf(b.id),
    );

    const res = await app.inject({
      method: "GET",
      url: "/leaderboard?limit=100",
    });
    const players = (
      res.json() as { players: Array<{ userId: string; rating: number }> }
    ).players;
    expect(players.find((p) => p.userId === a.id)?.rating).toBe(1550);
    expect(players.find((p) => p.userId === b.id)?.rating).toBe(1450);
  });

  it("keeps the Postgres match when Redis leaderboard sync fails", async () => {
    const p1 = await user(1180);
    const p2 = await user(1170);
    const expected = applyElo(1180, 1170);
    const beforeErrors = leaderboardErrors.length;

    const session = await sessions.create({
      player1UserId: p1.id,
      player2UserId: p2.id,
      player1Deck: [1, 2, 3, 4, 5].map((n) => flatCard(`c${n}`, 55)),
      player2Deck: [1, 2, 3, 4, 5].map((n) => flatCard(`d${n}`, 45)),
    });
    const forfeited = await sessions.update({
      ...session,
      state: { ...session.state, status: "finished" },
      outcome: {
        kind: "forfeit",
        winner: "player1",
        forfeitedBy: "player2",
      },
      endedAtMs: Date.now(),
    });
    if (!forfeited) throw new Error("failed to mark forfeit");

    const brokenFinalizer = createMatchFinalizer({
      sessions,
      leaderboard: {
        updateLeaderboardEntries: async () => {
          throw new Error("redis down");
        },
      },
      onLeaderboardError: (error) => {
        leaderboardErrors.push(error);
      },
    });

    const recorded = await brokenFinalizer.finalize(forfeited);
    expect(recorded.status).toBe("finished");
    expect(await findMatchByGameId(session.id)).not.toBeNull();
    expect(await ratingOf(p1.id)).toBe(expected.winnerRating);
    expect(await ratingOf(p2.id)).toBe(expected.loserRating);
    expect(leaderboardErrors.length).toBeGreaterThan(beforeErrors);
  });
});
