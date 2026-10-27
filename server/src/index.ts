import Fastify from "fastify";
import { env } from "./config";
import { pool } from "./db/pool";
import { redis } from "./db/redis";
import { healthRoutes } from "./http/health";

const app = Fastify({ logger: true });

app.register(healthRoutes);

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
