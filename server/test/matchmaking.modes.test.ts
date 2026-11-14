import { afterAll, describe, expect, it } from "vitest";
import { createModeQueues } from "../src/matchmaking/queue";
import { findAndClaimOpponent } from "../src/matchmaking/matcher";
import { isolatedRedis } from "./helpers/redis";

const redis = isolatedRedis();
const queues = createModeQueues(redis.client);

afterAll(async () => {
  await redis.cleanup();
});

describe("mode-isolated ranked queues", () => {
  it("never matches players queued for different modes", async () => {
    expect(await queues.add("classic", "a", 1000, 1)).toBe(true);
    expect(await queues.add("draft", "b", 1000, 2)).toBe(true);

    const classicAttempt = await findAndClaimOpponent(
      queues.forMode("classic"),
      "a",
      10_000,
      "classic",
    );
    expect(classicAttempt.matched).toBeNull();
    expect(await queues.isQueued("a")).toBe(true);
    expect(await queues.isQueued("b")).toBe(true);

    const draftAttempt = await findAndClaimOpponent(
      queues.forMode("draft"),
      "b",
      10_000,
      "draft",
    );
    expect(draftAttempt.matched).toBeNull();

    await queues.remove("a");
    await queues.remove("b");
  });

  it("matches two players on the same mode", async () => {
    expect(await queues.add("sudden_death", "x", 1000, 1)).toBe(true);
    expect(await queues.add("sudden_death", "y", 1010, 2)).toBe(true);

    const attempt = await findAndClaimOpponent(
      queues.forMode("sudden_death"),
      "x",
      10_000,
      "sudden_death",
    );
    expect(attempt.matched).toMatchObject({
      mode: "sudden_death",
      player1UserId: "x",
      player2UserId: "y",
    });

    // claimClosest removed ZSET members; scrub membership like the service does
    await queues.remove("x");
    await queues.remove("y");
    expect(await queues.list("sudden_death")).toEqual([]);
  });

  it("blocks joining a second mode while already queued", async () => {
    expect(await queues.add("tactical", "solo", 1200, 1)).toBe(true);
    expect(await queues.add("classic", "solo", 1200, 2)).toBe(false);
    expect(await queues.getMode("solo")).toBe("tactical");
    await queues.remove("solo");
  });
});
