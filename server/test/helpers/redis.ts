import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { env } from "../../src/config";

export function isolatedRedis() {
  const prefix = `test:${randomUUID()}:`;
  const client = new Redis(env.redisUrl, { keyPrefix: prefix });

  return {
    client,
    prefix,
    url: `${env.redisUrl}?keyPrefix=${encodeURIComponent(prefix)}`,
    async cleanup(): Promise<void> {
      const raw = new Redis(env.redisUrl);
      const keys: string[] = [];
      for await (const batch of raw.scanStream({ match: `${prefix}*` })) {
        keys.push(...(batch as string[]));
      }
      if (keys.length > 0) await raw.del(...keys);
      await raw.quit();
      await client.quit();
    },
  };
}
