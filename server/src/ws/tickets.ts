import { createHash, randomBytes } from "node:crypto";
import type Redis from "ioredis";
import { redis } from "../db/redis";

const TICKET_TTL_SECONDS = 30;
const TICKET_PREFIX = "ws:ticket:";

function hashTicket(rawTicket: string): string {
  return createHash("sha256").update(rawTicket).digest("hex");
}

function ticketKey(rawTicket: string): string {
  return `${TICKET_PREFIX}${hashTicket(rawTicket)}`;
}

export async function createWebSocketTicket(
  userId: string,
  client: Redis = redis,
): Promise<string> {
  const rawTicket = randomBytes(32).toString("base64url");
  await client.set(ticketKey(rawTicket), userId, "EX", TICKET_TTL_SECONDS);
  return rawTicket;
}

export async function verifyAndConsumeTicket(
  ticket: string,
  client: Redis = redis,
): Promise<{ userId: string } | null> {
  if (!ticket) {
    return null;
  }

  const userId = await client.getdel(ticketKey(ticket));
  if (!userId) {
    return null;
  }

  return { userId };
}
