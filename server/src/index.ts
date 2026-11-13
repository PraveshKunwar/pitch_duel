import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { env } from "./config";
import { pool } from "./db/pool";
import { redis } from "./db/redis";
import { findUserById } from "./db/users";
import { authRoutes } from "./http/auth";
import { healthRoutes } from "./http/health";
import { createMatchmakingService } from "./matchmaking/service";
import { createRedisGameSessionStore } from "./redis/gameSessionStore";
import { createMatchFinalizer } from "./ws/matchFinalizer";
import { setupWebSocket } from "./ws/server";

const app = Fastify({ logger: true });

app.register(jwt, {
  secret: env.jwtSecret,
  sign: { expiresIn: "15m" },
});
app.register(fastifyCookie);
app.register(healthRoutes);
app.register(authRoutes);

const sessions = createRedisGameSessionStore(redis);
const finalizer = createMatchFinalizer({ sessions });
setupWebSocket(app, {
  sessions,
  finalizer,
  createMatchmaking: ({ getSocket, send }) =>
    createMatchmakingService({
      redis,
      sessions,
      getRating: async (userId) => {
        const user = await findUserById(userId);
        return user ? Number(user.rating) : null;
      },
      getSocket,
      send,
    }),
});

async function main(): Promise<void> {
  await app.listen({ port: env.port, host: "0.0.0.0" });
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
