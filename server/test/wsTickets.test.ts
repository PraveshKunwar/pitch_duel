import { afterAll, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { env } from "../src/config";
import {
  createWebSocketTicket,
  verifyAndConsumeTicket,
} from "../src/ws/tickets";

const client = new Redis(env.redisUrl);

afterAll(async () => {
  await client.quit();
});

describe("websocket tickets", () => {
  it("creates and consumes a ticket once", async () => {
    const ticket = await createWebSocketTicket("user-1", client);
    expect(ticket.length).toBeGreaterThan(20);

    await expect(verifyAndConsumeTicket(ticket, client)).resolves.toEqual({
      userId: "user-1",
    });
    await expect(verifyAndConsumeTicket(ticket, client)).resolves.toBeNull();
  });

  it("rejects unknown tickets", async () => {
    await expect(verifyAndConsumeTicket("not-a-real-ticket", client)).resolves.toBeNull();
  });

  it("rejects expired tickets", async () => {
    const ticket = await createWebSocketTicket("user-2", client);
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(ticket).digest("hex");
    await client.pexpire(`ws:ticket:${hash}`, 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(verifyAndConsumeTicket(ticket, client)).resolves.toBeNull();
  });

  it("allows only one concurrent consumer to succeed", async () => {
    const ticket = await createWebSocketTicket("user-3", client);
    const [first, second] = await Promise.all([
      verifyAndConsumeTicket(ticket, client),
      verifyAndConsumeTicket(ticket, client),
    ]);
    const wins = [first, second].filter((result) => result !== null);
    expect(wins).toHaveLength(1);
    expect(wins[0]).toEqual({ userId: "user-3" });
  });
});
