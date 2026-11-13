import { afterAll, describe, expect, it } from "vitest";
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

afterAll(async () => {
  await deleteTestUsers(created);
  await redis.cleanup();
});

describe("leaderboard Redis service", () => {
  it("adds a player to the sorted set", async () => {
    await leaderboard.updateLeaderboardEntry("p1", 1540);
    expect(await leaderboard.getPlayerRating("p1")).toBe(1540);
    expect(await leaderboard.getPlayerRank("p1")).toBe(1);
    await leaderboard.removeLeaderboardEntry("p1");
  });

  it("updates an existing player's rating", async () => {
    await leaderboard.updateLeaderboardEntry("p1", 1000);
    await leaderboard.updateLeaderboardEntry("p1", 1200);
    expect(await leaderboard.getPlayerRating("p1")).toBe(1200);
    await leaderboard.removeLeaderboardEntry("p1");
  });

  it("orders multiple players by rating descending", async () => {
    await leaderboard.updateLeaderboardEntries([
      { userId: "a", rating: 1310 },
      { userId: "b", rating: 1540 },
      { userId: "c", rating: 1420 },
    ]);

    expect(await leaderboard.getTopPlayers(10)).toEqual([
      { userId: "b", rating: 1540, rank: 1 },
      { userId: "c", rating: 1420, rank: 2 },
      { userId: "a", rating: 1310, rank: 3 },
    ]);

    await leaderboard.removeLeaderboardEntry("a");
    await leaderboard.removeLeaderboardEntry("b");
    await leaderboard.removeLeaderboardEntry("c");
  });

  it("retrieves the highest-rated players for a limit", async () => {
    await leaderboard.updateLeaderboardEntries([
      { userId: "1", rating: 1500 },
      { userId: "2", rating: 1400 },
      { userId: "3", rating: 1300 },
      { userId: "4", rating: 1200 },
    ]);

    expect(await leaderboard.getTopPlayers(2)).toEqual([
      { userId: "1", rating: 1500, rank: 1 },
      { userId: "2", rating: 1400, rank: 2 },
    ]);

    for (const id of ["1", "2", "3", "4"]) {
      await leaderboard.removeLeaderboardEntry(id);
    }
  });

  it("ties break by reverse lexicographic member id under ZREVRANGE", async () => {
    await leaderboard.updateLeaderboardEntries([
      { userId: "zebra", rating: 1000 },
      { userId: "alpha", rating: 1000 },
    ]);

    // Equal scores: ZREVRANGE reverses the lexicographic order Redis uses for ZRANGE.
    expect(await leaderboard.getTopPlayers(2)).toEqual([
      { userId: "zebra", rating: 1000, rank: 1 },
      { userId: "alpha", rating: 1000, rank: 2 },
    ]);

    await leaderboard.removeLeaderboardEntry("alpha");
    await leaderboard.removeLeaderboardEntry("zebra");
  });

  it("returns null rank for a nonexistent player", async () => {
    expect(await leaderboard.getPlayerRank("missing")).toBeNull();
    expect(await leaderboard.getPlayerRating("missing")).toBeNull();
  });

  it("removes a player from the sorted set", async () => {
    await leaderboard.updateLeaderboardEntry("gone", 1100);
    expect(await leaderboard.removeLeaderboardEntry("gone")).toBe(true);
    expect(await leaderboard.getPlayerRating("gone")).toBeNull();
    expect(await leaderboard.removeLeaderboardEntry("gone")).toBe(false);
  });

  it("returns empty results for an empty leaderboard", async () => {
    await redis.client.del(LEADERBOARD_KEY);
    expect(await leaderboard.count()).toBe(0);
    expect(await leaderboard.getTopPlayers(10)).toEqual([]);
  });

  it("rebuilds the sorted set from PostgreSQL ratings", async () => {
    const [high, mid, low] = [
      await user(1500),
      await user(1350),
      await user(1200),
    ];

    await leaderboard.updateLeaderboardEntry("stale", 9999);
    const rebuilt = await leaderboard.rebuildLeaderboard();
    expect(rebuilt.count).toBeGreaterThanOrEqual(3);

    const top = await leaderboard.getTopPlayers(100);
    const byId = new Map(top.map((entry) => [entry.userId, entry]));

    expect(byId.get(high.id)).toMatchObject({ rating: 1500 });
    expect(byId.get(mid.id)).toMatchObject({ rating: 1350 });
    expect(byId.get(low.id)).toMatchObject({ rating: 1200 });
    expect(byId.has("stale")).toBe(false);

    const highRank = await leaderboard.getPlayerRank(high.id);
    const midRank = await leaderboard.getPlayerRank(mid.id);
    const lowRank = await leaderboard.getPlayerRank(low.id);
    expect(highRank).not.toBeNull();
    expect(midRank).not.toBeNull();
    expect(lowRank).not.toBeNull();
    expect(highRank!).toBeLessThan(midRank!);
    expect(midRank!).toBeLessThan(lowRank!);
  });
});
