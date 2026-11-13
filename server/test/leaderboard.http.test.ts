import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { leaderboardRoutes } from "../src/http/leaderboard";
import { createLeaderboardService } from "../src/leaderboard/leaderboard";
import { LEADERBOARD_KEY } from "../src/leaderboard/types";
import {
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from "./helpers/db";
import { isolatedRedis } from "./helpers/redis";

const redis = isolatedRedis();
const leaderboard = createLeaderboardService(redis.client, LEADERBOARD_KEY);
const created: string[] = [];

async function user(rating = 1000): Promise<TestUser> {
  const made = await createTestUser(rating);
  created.push(made.id);
  return made;
}

const app = Fastify({ logger: false });
app.register(leaderboardRoutes(leaderboard));

afterAll(async () => {
  await app.close();
  await deleteTestUsers(created);
  await redis.cleanup();
});

describe("GET /leaderboard", () => {
  it("returns top 10 by default", async () => {
    await app.ready();
    const players = [];
    for (let i = 0; i < 12; i++) {
      const made = await user(1100 + i);
      players.push(made);
      await leaderboard.updateLeaderboardEntry(made.id, 1100 + i);
    }

    const res = await app.inject({ method: "GET", url: "/leaderboard" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      players: Array<{ userId: string; username: string; rating: number; rank: number }>;
    };
    expect(body.players).toHaveLength(10);
    expect(body.players[0].rank).toBe(1);
    expect(body.players[0].rating).toBe(1111);
    expect(body.players[0].username).toBe(players[11].username);
    expect(body.players[9].rating).toBe(1102);
  });

  it("honors limit=5", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/leaderboard?limit=5",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().players).toHaveLength(5);
  });

  it("allows limit=100", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/leaderboard?limit=100",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().players.length).toBeGreaterThanOrEqual(10);
    expect(res.json().players.length).toBeLessThanOrEqual(100);
  });

  it("rejects invalid limits", async () => {
    for (const limit of ["0", "-1", "1.5", "abc", "101"]) {
      const res = await app.inject({
        method: "GET",
        url: `/leaderboard?limit=${limit}`,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("returns an empty players array when the board is empty", async () => {
    const emptyRedis = isolatedRedis();
    const emptyBoard = createLeaderboardService(
      emptyRedis.client,
      LEADERBOARD_KEY,
    );
    const emptyApp = Fastify({ logger: false });
    emptyApp.register(leaderboardRoutes(emptyBoard));
    await emptyApp.ready();

    const res = await emptyApp.inject({ method: "GET", url: "/leaderboard" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ players: [] });

    await emptyApp.close();
    await emptyRedis.cleanup();
  });

  it("returns null username when the Redis member is missing from Postgres", async () => {
    await leaderboard.updateLeaderboardEntry("999999999999", 2000);

    const res = await app.inject({
      method: "GET",
      url: "/leaderboard?limit=1",
    });
    expect(res.statusCode).toBe(200);
    const top = res.json().players[0];
    expect(top.userId).toBe("999999999999");
    expect(top.username).toBeNull();
    expect(top.rating).toBe(2000);
    expect(top.rank).toBe(1);

    await leaderboard.removeLeaderboardEntry("999999999999");
  });

  it("returns 503 when Redis is unavailable", async () => {
    const dead = isolatedRedis();
    const deadBoard = createLeaderboardService(dead.client, LEADERBOARD_KEY);
    await dead.client.quit();

    const deadApp = Fastify({ logger: false });
    deadApp.register(leaderboardRoutes(deadBoard));
    await deadApp.ready();

    const res = await deadApp.inject({ method: "GET", url: "/leaderboard" });
    expect(res.statusCode).toBe(503);

    await deadApp.close();
  });
});
