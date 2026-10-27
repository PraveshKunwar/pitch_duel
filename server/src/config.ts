import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../../.env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  jwtSecret: required("JWT_SECRET"),
  port: Number(process.env.PORT ?? 3000),
};
