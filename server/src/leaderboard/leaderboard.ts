import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import type pg from "pg";
import { pool } from "../db/pool";
import {
  LEADERBOARD_KEY,
  MAX_LEADERBOARD_LIMIT,
  type LeaderboardEntry,
  type RankedLeaderboardEntry,
} from "./types";

export interface LeaderboardService {
  updateLeaderboardEntry(userId: string, rating: number): Promise<void>;
  updateLeaderboardEntries(entries: LeaderboardEntry[]): Promise<void>;
  getTopPlayers(limit: number): Promise<RankedLeaderboardEntry[]>;
  getPlayerRank(userId: string): Promise<number | null>;
  getPlayerRating(userId: string): Promise<number | null>;
  removeLeaderboardEntry(userId: string): Promise<boolean>;
  count(): Promise<number>;
  rebuildLeaderboard(
    db?: Pick<pg.Pool, "query">,
  ): Promise<{ count: number }>;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("limit must be a positive integer");
  }
  return Math.min(Math.floor(limit), MAX_LEADERBOARD_LIMIT);
}

export function createLeaderboardService(
  client: Redis,
  key: string = LEADERBOARD_KEY,
): LeaderboardService {
  return {
    async updateLeaderboardEntry(userId, rating) {
      await client.zadd(key, rating, userId);
    },

    async updateLeaderboardEntries(entries) {
      if (entries.length === 0) return;
      const args: Array<string | number> = [];
      for (const entry of entries) {
        args.push(entry.rating, entry.userId);
      }
      await client.zadd(key, ...args);
    },

    async getTopPlayers(limit) {
      const capped = clampLimit(limit);
      const rows = await client.zrevrange(key, 0, capped - 1, "WITHSCORES");
      const players: RankedLeaderboardEntry[] = [];
      for (let i = 0; i < rows.length; i += 2) {
        players.push({
          userId: rows[i],
          rating: Number(rows[i + 1]),
          rank: players.length + 1,
        });
      }
      return players;
    },

    async getPlayerRank(userId) {
      const rank = await client.zrevrank(key, userId);
      return rank === null ? null : rank + 1;
    },

    async getPlayerRating(userId) {
      const score = await client.zscore(key, userId);
      return score === null ? null : Number(score);
    },

    async removeLeaderboardEntry(userId) {
      return (await client.zrem(key, userId)) > 0;
    },

    async count() {
      return client.zcard(key);
    },

    async rebuildLeaderboard(db: Pick<pg.Pool, "query"> = pool) {
      const result = await db.query<{ id: string; rating: number }>(
        `SELECT id, rating FROM users ORDER BY id`,
      );
      const tempKey = `${key}:rebuild:${randomUUID()}`;
      try {
        if (result.rows.length > 0) {
          const args: Array<string | number> = [];
          for (const row of result.rows) {
            args.push(Number(row.rating), String(row.id));
          }
          await client.zadd(tempKey, ...args);
        }
        // Atomic swap: drop live key, then promote temp if populated.
        // Empty Postgres → empty Redis (DEL alone). Non-empty → RENAME.
        await client.eval(
          `
local live = KEYS[1]
local temp = KEYS[2]
redis.call('DEL', live)
if redis.call('EXISTS', temp) == 1 then
  redis.call('RENAME', temp, live)
end
return redis.call('ZCARD', live)
`,
          2,
          key,
          tempKey,
        );
        return { count: result.rows.length };
      } catch (error) {
        await client.del(tempKey).catch(() => undefined);
        throw error;
      }
    },
  };
}
