import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { env } from "./config";
import { pool } from "./db/pool";
import { redis } from "./db/redis";
import { authRoutes } from "./http/auth";
import { healthRoutes } from "./http/health";
import jwt from "@fastify/jwt";

const app = Fastify({ logger: true });

app.register(jwt, {
  secret: env.jwtSecret,
  sign: { expiresIn: "15m" },
});
app.register(fastifyCookie);
app.register(healthRoutes);
app.register(authRoutes);

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

app.listen({ port: env.port, host: "0.0.0.0" }).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
