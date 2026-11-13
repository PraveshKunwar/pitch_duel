import type Redis from "ioredis";
import { redis } from "../db/redis";
import {
  buildSession,
  type GameSession,
  type GameSessionStore,
  type SessionCreatedListener,
} from "../ws/gameSessions";

export const gameStateKey = (gameId: string) => `game:${gameId}:state`;
export const userGameKey = (userId: string) => `user:${userId}:game`;
export const UNPERSISTED_GAMES_KEY = "games:unpersisted";

const LIVE_TTL_SECONDS = 60 * 60;
const UNPERSISTED_TTL_SECONDS = 24 * 60 * 60;
const PERSISTED_TTL_SECONDS = 10 * 60;

const COMPARE_AND_SWAP = `
if redis.call('HGET', KEYS[1], 'version') ~= ARGV[1] then
  return 0
end
redis.call('HSET', KEYS[1], 'version', ARGV[2], 'data', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
if ARGV[5] ~= '' then
  redis.call('SADD', KEYS[2], ARGV[5])
end
return 1
`;

const MARK_PERSISTED = `
redis.call('SREM', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[2], ARGV[2])
for i = 3, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
  end
end
return 1
`;

export function createRedisGameSessionStore(
  client: Redis = redis,
): GameSessionStore {
  let onCreated: SessionCreatedListener | null = null;

  async function get(gameId: string): Promise<GameSession | null> {
    const data = await client.hget(gameStateKey(gameId), "data");
    return data ? (JSON.parse(data) as GameSession) : null;
  }

  return {
    get,

    async create(input) {
      const session = buildSession(input);
      const key = gameStateKey(session.id);
      const results = await client
        .multi()
        .hset(key, "version", session.version, "data", JSON.stringify(session))
        .expire(key, LIVE_TTL_SECONDS)
        .set(
          userGameKey(session.player1UserId),
          session.id,
          "EX",
          LIVE_TTL_SECONDS,
        )
        .set(
          userGameKey(session.player2UserId),
          session.id,
          "EX",
          LIVE_TTL_SECONDS,
        )
        .exec();
      const failed = results?.find(([error]) => error);
      if (!results || failed) {
        throw failed?.[0] ?? new Error("Redis discarded the game creation");
      }

      if (!onCreated) return session;
      await onCreated(session);
      return (await get(session.id)) ?? session;
    },

    async update(next) {
      const saved: GameSession = { ...next, version: next.version + 1 };
      const finished = saved.state.status === "finished";
      const written = await client.eval(
        COMPARE_AND_SWAP,
        2,
        gameStateKey(saved.id),
        UNPERSISTED_GAMES_KEY,
        String(next.version),
        String(saved.version),
        JSON.stringify(saved),
        String(finished ? UNPERSISTED_TTL_SECONDS : LIVE_TTL_SECONDS),
        finished ? saved.id : "",
      );
      return written === 1 ? saved : null;
    },

    async activeGameFor(userId) {
      return client.get(userGameKey(userId));
    },

    async unpersisted() {
      return client.smembers(UNPERSISTED_GAMES_KEY);
    },

    async markPersisted(gameId, userIds = []) {
      await client.eval(
        MARK_PERSISTED,
        2 + userIds.length,
        UNPERSISTED_GAMES_KEY,
        gameStateKey(gameId),
        ...userIds.map(userGameKey),
        gameId,
        String(PERSISTED_TTL_SECONDS),
      );
    },

    setOnCreated(listener) {
      onCreated = listener;
    },
  };
}
