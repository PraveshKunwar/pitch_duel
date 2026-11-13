import type Redis from "ioredis";
import { gameEventsChannel, userEventsChannel } from "./channels";
import {
  parseGameBusEvent,
  parseUserBusEvent,
  type GameBusEvent,
  type UserBusEvent,
} from "./events";

export type GameEventHandler = (
  event: GameBusEvent,
) => void | Promise<unknown>;
export type UserEventHandler = (
  userId: string,
  event: UserBusEvent,
) => void | Promise<unknown>;

export interface EventSubscriber {
  retainGame(gameId: string): Promise<void>;
  releaseGame(gameId: string): Promise<void>;
  retainUser(userId: string): Promise<void>;
  releaseUser(userId: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface EventSubscriberOptions {
  redis: Redis;
  onGameEvent: GameEventHandler;
  onUserEvent: UserEventHandler;
  onError?: (error: unknown, context: { channel: string }) => void;
}

/**
 * Dedicated Redis connection in subscribe mode.
 * Refcounted per game/user channel so instances only listen where they have locals.
 */
export function createEventSubscriber(
  options: EventSubscriberOptions,
): EventSubscriber {
  const sub = options.redis.duplicate();
  const gameRefs = new Map<string, number>();
  const userRefs = new Map<string, number>();
  const report =
    options.onError ??
    ((error, context) => console.error("redis subscriber", context, error));

  sub.on("message", (channel, payload) => {
    void (async () => {
      try {
        if (channel.startsWith("game:") && channel.endsWith(":events")) {
          const event = parseGameBusEvent(payload);
          if (event) await options.onGameEvent(event);
          return;
        }
        if (channel.startsWith("user:") && channel.endsWith(":events")) {
          const userId = channel.slice("user:".length, -":events".length);
          const event = parseUserBusEvent(payload);
          if (event) await options.onUserEvent(userId, event);
        }
      } catch (error) {
        report(error, { channel });
      }
    })();
  });

  async function retain(
    refs: Map<string, number>,
    key: string,
    channel: string,
  ): Promise<void> {
    const current = refs.get(key) ?? 0;
    refs.set(key, current + 1);
    if (current === 0) {
      await sub.subscribe(channel);
    }
  }

  async function release(
    refs: Map<string, number>,
    key: string,
    channel: string,
  ): Promise<void> {
    const current = refs.get(key) ?? 0;
    if (current <= 0) return;
    if (current === 1) {
      refs.delete(key);
      await sub.unsubscribe(channel);
      return;
    }
    refs.set(key, current - 1);
  }

  return {
    retainGame(gameId) {
      return retain(gameRefs, gameId, gameEventsChannel(gameId));
    },
    releaseGame(gameId) {
      return release(gameRefs, gameId, gameEventsChannel(gameId));
    },
    retainUser(userId) {
      return retain(userRefs, userId, userEventsChannel(userId));
    },
    releaseUser(userId) {
      return release(userRefs, userId, userEventsChannel(userId));
    },
    async dispose() {
      gameRefs.clear();
      userRefs.clear();
      sub.removeAllListeners("message");
      await sub.quit();
    },
  };
}
