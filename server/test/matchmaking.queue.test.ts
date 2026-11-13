import { afterAll, describe, expect, it } from "vitest";
import { findAndClaimOpponent } from "../src/matchmaking/matcher";
import { createRankedQueue } from "../src/matchmaking/queue";
import { DEFAULT_MATCHMAKING_CONFIG } from "../src/matchmaking/types";
import { isolatedRedis } from "./helpers/redis";

const redis = isolatedRedis();
const queue = createRankedQueue(redis.client);

afterAll(async () => {
  await redis.cleanup();
});

describe("ranked matchmaking queue", () => {
  it("adds, inspects, and removes players without duplicates", async () => {
    expect(await queue.add("a", 1000, 1_000)).toBe(true);
    expect(await queue.add("a", 1100, 2_000)).toBe(false);
    expect(await queue.isQueued("a")).toBe(true);
    expect(await queue.get("a")).toEqual({
      userId: "a",
      rating: 1000,
      joinedAtMs: 1_000,
    });
    expect(await queue.remove("a")).toBe(true);
    expect(await queue.isQueued("a")).toBe(false);
    expect(await queue.remove("a")).toBe(false);
  });

  it("claims the closest eligible opponent and removes both", async () => {
    await queue.add("seeker", 1000, 1);
    await queue.add("far", 1300, 2);
    await queue.add("close", 1040, 3);
    await queue.add("closer", 1010, 4);

    const claimed = await queue.claimClosest("seeker", 100);
    expect(claimed).toEqual({
      seekerId: "seeker",
      opponentId: "closer",
      seekerRating: 1000,
      opponentRating: 1010,
    });
    expect(await queue.isQueued("seeker")).toBe(false);
    expect(await queue.isQueued("closer")).toBe(false);
    expect(await queue.isQueued("close")).toBe(true);
    expect(await queue.isQueued("far")).toBe(true);

    await queue.remove("close");
    await queue.remove("far");
  });

  it("does not claim opponents outside the rating window", async () => {
    await queue.add("seeker", 1000, 1);
    await queue.add("far", 1300, 2);

    expect(await queue.claimClosest("seeker", 100)).toBeNull();
    expect(await queue.isQueued("seeker")).toBe(true);
    expect(await queue.isQueued("far")).toBe(true);

    await queue.remove("seeker");
    await queue.remove("far");
  });

  it("tie-breaks equal rating distance by earliest join time", async () => {
    await queue.add("seeker", 1000, 10);
    await queue.add("later", 1050, 30);
    await queue.add("earlier", 950, 20);

    const claimed = await queue.claimClosest("seeker", 100);
    expect(claimed?.opponentId).toBe("earlier");

    await queue.remove("later");
  });

  it("only one concurrent claim can win the same opponent", async () => {
    await queue.add("a", 1000, 1);
    await queue.add("b", 1000, 2);

    const [first, second] = await Promise.all([
      queue.claimClosest("a", 100),
      queue.claimClosest("b", 100),
    ]);

    const wins = [first, second].filter(Boolean);
    expect(wins).toHaveLength(1);
    expect(await queue.list()).toEqual([]);
  });

  it("findAndClaimOpponent respects expanding wait tolerance", async () => {
    await queue.add("seeker", 1000, 0);
    await queue.add("mid", 1180, 1);

    const tooSoon = await findAndClaimOpponent(queue, "seeker", 5_000);
    expect(tooSoon.matched).toBeNull();
    expect(await queue.isQueued("seeker")).toBe(true);

    const later = await findAndClaimOpponent(
      queue,
      "seeker",
      15_000,
      DEFAULT_MATCHMAKING_CONFIG,
    );
    expect(later.matched).toMatchObject({
      player1UserId: "mid",
      player2UserId: "seeker",
    });
    expect(await queue.list()).toEqual([]);
  });
});
