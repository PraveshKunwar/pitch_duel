import { afterAll, describe, expect, it } from "vitest";
import { createEventPublisher } from "../src/redis/publisher";
import { createEventSubscriber } from "../src/redis/subscriber";
import type { GameBusEvent } from "../src/redis/events";
import { isolatedRedis } from "./helpers/redis";

const redis = isolatedRedis();

describe("redis pub/sub", () => {
  afterAll(async () => {
    await redis.cleanup();
  });

  it("both subscribers receive a published game event", async () => {
    const receivedA: GameBusEvent[] = [];
    const receivedB: GameBusEvent[] = [];

    const subA = createEventSubscriber({
      redis: redis.client,
      onGameEvent: (event) => {
        receivedA.push(event);
      },
      onUserEvent: () => undefined,
    });
    const subB = createEventSubscriber({
      redis: redis.client,
      onGameEvent: (event) => {
        receivedB.push(event);
      },
      onUserEvent: () => undefined,
    });

    const gameId = "game-pubsub-1";
    await subA.retainGame(gameId);
    await subB.retainGame(gameId);

    // Give Redis a beat to finish SUBSCRIBE.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const publisher = createEventPublisher(redis.client);
    await publisher.publishGame({
      kind: "round_started",
      gameId,
      round: 1,
      category: "attack",
      deadlineMs: Date.now() + 20_000,
      originInstanceId: "publisher",
    });

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3_000;
      const tick = () => {
        if (receivedA.length > 0 && receivedB.length > 0) {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error("subscribers never received the event"));
          return;
        }
        setTimeout(tick, 25);
      };
      tick();
    });

    expect(receivedA[0]?.kind).toBe("round_started");
    expect(receivedB[0]?.kind).toBe("round_started");

    await subA.dispose();
    await subB.dispose();
  });
});
