import type { FastifyInstance } from "fastify";
import { env } from "../config";
import { pool } from "../db/pool";
import { redis } from "../db/redis";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    let postgres: "up" | "down" = "down";
    let redisStatus: "up" | "down" = "down";

    try {
      await pool.query("SELECT 1");
      postgres = "up";
    } catch {
      postgres = "down";
    }

    try {
      redisStatus = (await redis.ping()) === "PONG" ? "up" : "down";
    } catch {
      redisStatus = "down";
    }

    const ok = postgres === "up" && redisStatus === "up";
    return reply.code(ok ? 200 : 503).send({
      status: ok ? "ok" : "degraded",
      instanceId: env.instanceId,
      postgres,
      redis: redisStatus,
    });
  });
}
