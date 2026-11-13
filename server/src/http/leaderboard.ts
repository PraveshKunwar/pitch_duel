import type { FastifyInstance } from "fastify";
import { findUsersByIds } from "../db/users";
import type { LeaderboardService } from "../leaderboard/leaderboard";
import {
  DEFAULT_LEADERBOARD_LIMIT,
  MAX_LEADERBOARD_LIMIT,
  type LeaderboardResponse,
} from "../leaderboard/types";

function parseLimit(raw: unknown): number | { error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_LEADERBOARD_LIMIT;
  }
  const value =
    typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < 1) {
    return { error: "limit must be a positive integer" };
  }
  if (value > MAX_LEADERBOARD_LIMIT) {
    return {
      error: `limit must be at most ${MAX_LEADERBOARD_LIMIT}`,
    };
  }
  return value;
}

export function leaderboardRoutes(leaderboard: LeaderboardService) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get<{ Querystring: { limit?: string } }>(
      "/leaderboard",
      async (request, reply) => {
        const parsed = parseLimit(request.query.limit);
        if (typeof parsed === "object") {
          return reply.code(400).send({
            statusCode: 400,
            error: "Bad Request",
            message: parsed.error,
          });
        }

        try {
          const ranked = await leaderboard.getTopPlayers(parsed);
          const profiles = await findUsersByIds(
            ranked.map((entry) => entry.userId),
          );
          const usernameOf = new Map(
            profiles.map((user) => [user.id, user.username]),
          );

          const body: LeaderboardResponse = {
            players: ranked.map((entry) => ({
              userId: entry.userId,
              username: usernameOf.get(entry.userId) ?? null,
              rating: entry.rating,
              rank: entry.rank,
            })),
          };
          return reply.code(200).send(body);
        } catch (error) {
          request.log.error({ err: error }, "leaderboard lookup failed");
          return reply.code(503).send({
            statusCode: 503,
            error: "Service Unavailable",
            message: "Leaderboard temporarily unavailable",
          });
        }
      },
    );
  };
}
