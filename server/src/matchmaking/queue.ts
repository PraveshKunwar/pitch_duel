import type Redis from "ioredis";
import type { GameMode } from "../game/modes";
import { GAME_MODES, isGameMode } from "../game/modes";
import type {
  MatchmakingConfig,
  QueuedPlayer,
  SingleQueueConfig,
} from "./types";
import {
  DEFAULT_MATCHMAKING_CONFIG,
  LEGACY_SINGLE_QUEUE_CONFIG,
  queueKeysForMode,
} from "./types";

const ADD_IF_ABSENT = `
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  return 0
end
redis.call('ZADD', KEYS[1], tonumber(ARGV[2]), ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
return 1
`;

const CLAIM_CLOSEST = `
local seeker = ARGV[1]
local maxDelta = tonumber(ARGV[2])

local seekerScore = redis.call('ZSCORE', KEYS[1], seeker)
if not seekerScore then
  return nil
end
seekerScore = tonumber(seekerScore)

local minScore = seekerScore - maxDelta
local maxScore = seekerScore + maxDelta
local candidates = redis.call('ZRANGEBYSCORE', KEYS[1], minScore, maxScore, 'WITHSCORES')

local bestId = nil
local bestDiff = nil
local bestJoined = nil
local bestRating = nil

for i = 1, #candidates, 2 do
  local id = candidates[i]
  local rating = tonumber(candidates[i + 1])
  if id ~= seeker then
    local diff = math.abs(rating - seekerScore)
    local joined = tonumber(redis.call('HGET', KEYS[2], id) or '0')
    if bestId == nil
      or diff < bestDiff
      or (diff == bestDiff and joined < bestJoined)
      or (diff == bestDiff and joined == bestJoined and id < bestId)
    then
      bestId = id
      bestDiff = diff
      bestJoined = joined
      bestRating = rating
    end
  end
end

if not bestId then
  return nil
end

redis.call('ZREM', KEYS[1], seeker, bestId)
redis.call('HDEL', KEYS[2], seeker, bestId)
return { seeker, bestId, tostring(seekerScore), tostring(bestRating) }
`;

export interface RankedQueue {
  add(userId: string, rating: number, joinedAtMs: number): Promise<boolean>;
  remove(userId: string): Promise<boolean>;
  isQueued(userId: string): Promise<boolean>;
  get(userId: string): Promise<Omit<QueuedPlayer, "mode"> | null>;
  list(): Promise<Array<Omit<QueuedPlayer, "mode">>>;
  claimClosest(
    seekerId: string,
    maxDelta: number,
  ): Promise<{
    seekerId: string;
    opponentId: string;
    seekerRating: number;
    opponentRating: number;
  } | null>;
}

export function createRankedQueue(
  client: Redis,
  config: SingleQueueConfig = LEGACY_SINGLE_QUEUE_CONFIG,
): RankedQueue {
  const { queueKey, joinedKey } = config;

  return {
    async add(userId, rating, joinedAtMs) {
      const added = await client.eval(
        ADD_IF_ABSENT,
        2,
        queueKey,
        joinedKey,
        userId,
        String(rating),
        String(joinedAtMs),
      );
      return added === 1;
    },

    async remove(userId) {
      const results = await client
        .multi()
        .zrem(queueKey, userId)
        .hdel(joinedKey, userId)
        .exec();
      const removed = Number(results?.[0]?.[1] ?? 0);
      return removed > 0;
    },

    async isQueued(userId) {
      return (await client.zscore(queueKey, userId)) !== null;
    },

    async get(userId) {
      const [rating, joined] = await Promise.all([
        client.zscore(queueKey, userId),
        client.hget(joinedKey, userId),
      ]);
      if (rating === null) return null;
      return {
        userId,
        rating: Number(rating),
        joinedAtMs: Number(joined ?? 0),
      };
    },

    async list() {
      const [members, joinedMap] = await Promise.all([
        client.zrange(queueKey, 0, -1, "WITHSCORES"),
        client.hgetall(joinedKey),
      ]);
      const players: Array<Omit<QueuedPlayer, "mode">> = [];
      for (let i = 0; i < members.length; i += 2) {
        const userId = members[i];
        players.push({
          userId,
          rating: Number(members[i + 1]),
          joinedAtMs: Number(joinedMap[userId] ?? 0),
        });
      }
      return players;
    },

    async claimClosest(seekerId, maxDelta) {
      const result = await client.eval(
        CLAIM_CLOSEST,
        2,
        queueKey,
        joinedKey,
        seekerId,
        String(maxDelta),
      );
      if (!Array.isArray(result) || result.length < 4) return null;
      return {
        seekerId: String(result[0]),
        opponentId: String(result[1]),
        seekerRating: Number(result[2]),
        opponentRating: Number(result[3]),
      };
    },
  };
}

export interface ModeQueues {
  add(
    mode: GameMode,
    userId: string,
    rating: number,
    joinedAtMs: number,
  ): Promise<boolean>;
  remove(userId: string): Promise<boolean>;
  isQueued(userId: string): Promise<boolean>;
  getMode(userId: string): Promise<GameMode | null>;
  get(userId: string): Promise<QueuedPlayer | null>;
  list(mode: GameMode): Promise<QueuedPlayer[]>;
  listAll(): Promise<QueuedPlayer[]>;
  forMode(mode: GameMode): RankedQueue;
}

export function createModeQueues(
  client: Redis,
  config: MatchmakingConfig = DEFAULT_MATCHMAKING_CONFIG,
): ModeQueues {
  const queues = new Map<GameMode, RankedQueue>();
  for (const mode of GAME_MODES) {
    const keys = queueKeysForMode(mode, config);
    queues.set(
      mode,
      createRankedQueue(client, {
        ...LEGACY_SINGLE_QUEUE_CONFIG,
        queueKey: keys.queueKey,
        joinedKey: keys.joinedKey,
        toleranceBands: config.toleranceBands,
        maxWaitMs: config.maxWaitMs,
        tickMs: config.tickMs,
      }),
    );
  }

  const membershipKey = config.membershipKey;

  return {
    forMode(mode) {
      const queue = queues.get(mode);
      if (!queue) throw new Error(`Unknown mode ${mode}`);
      return queue;
    },

    async getMode(userId) {
      const raw = await client.hget(membershipKey, userId);
      return isGameMode(raw) ? raw : null;
    },

    async add(mode, userId, rating, joinedAtMs) {
      const existing = await client.hget(membershipKey, userId);
      if (existing) return false;
      const queue = queues.get(mode);
      if (!queue) throw new Error(`Unknown mode ${mode}`);
      const added = await queue.add(userId, rating, joinedAtMs);
      if (!added) return false;
      await client.hset(membershipKey, userId, mode);
      return true;
    },

    async remove(userId) {
      const mode = await this.getMode(userId);
      if (!mode) {
        // Best-effort: scrub every mode queue.
        let removed = false;
        for (const queue of queues.values()) {
          if (await queue.remove(userId)) removed = true;
        }
        await client.hdel(membershipKey, userId);
        return removed;
      }
      const removed = await queues.get(mode)!.remove(userId);
      await client.hdel(membershipKey, userId);
      return removed;
    },

    async isQueued(userId) {
      return (await this.getMode(userId)) !== null;
    },

    async get(userId) {
      const mode = await this.getMode(userId);
      if (!mode) return null;
      const row = await queues.get(mode)!.get(userId);
      if (!row) {
        await client.hdel(membershipKey, userId);
        return null;
      }
      return { ...row, mode };
    },

    async list(mode) {
      const rows = await queues.get(mode)!.list();
      return rows.map((row) => ({ ...row, mode }));
    },

    async listAll() {
      const all: QueuedPlayer[] = [];
      for (const mode of GAME_MODES) {
        all.push(...(await this.list(mode)));
      }
      return all;
    },
  };
}
