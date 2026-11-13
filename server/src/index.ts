import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { env } from "./config";
import { pool } from "./db/pool";
import { redis } from "./db/redis";
import { findUserById } from "./db/users";
import { authRoutes } from "./http/auth";
import { healthRoutes } from "./http/health";
import { leaderboardRoutes } from "./http/leaderboard";
import { createLeaderboardService } from "./leaderboard/leaderboard";
import { createMatchmakingService } from "./matchmaking/service";
import { createRedisGameSessionStore } from "./redis/gameSessionStore";
import { createMatchFinalizer } from "./ws/matchFinalizer";
import { setupWebSocket } from "./ws/server";

const app = Fastify({ logger: true });

app.register(cors, {
  origin: env.corsOrigin,
  credentials: true,
});
app.register(jwt, {
  secret: env.jwtSecret,
  sign: { expiresIn: "15m" },
});
app.register(fastifyCookie);
app.register(healthRoutes);
app.register(authRoutes);

const sessions = createRedisGameSessionStore(redis);
const leaderboard = createLeaderboardService(redis);
app.register(leaderboardRoutes(leaderboard));
const finalizer = createMatchFinalizer({
  sessions,
  leaderboard,
  onLeaderboardError: (error, context) => {
    app.log.error(
      { err: error, gameId: context.gameId, userIds: context.userIds },
      "leaderboard update failed after match commit",
    );
  },
});
setupWebSocket(app, {
  sessions,
  finalizer,
  redis,
  instanceId: env.instanceId,
  createMatchmaking: ({ getSocket, send, fanout }) =>
    createMatchmakingService({
      redis,
      sessions,
      getRating: async (userId) => {
        const user = await findUserById(userId);
        return user ? Number(user.rating) : null;
      },
      getUsername: async (userId) => {
        const user = await findUserById(userId);
        return user?.username ?? null;
      },
      getSocket,
      send,
      fanout,
    }),
});

async function main(): Promise<void> {
  await app.listen({ port: env.port, host: "0.0.0.0" });
  app.log.info(
    { instanceId: env.instanceId, port: env.port },
    "application instance listening",
  );
}

const shutdown = async () => {
  await app.close();
  await pool.end();
  redis.disconnect();
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown().finally(() => process.exit(0));
  });
}

main().catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});

export { app, sessions };
