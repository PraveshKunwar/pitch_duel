import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "../src/config";
import { authRoutes } from "../src/http/auth";
import { createUser } from "../src/db/users";
import { hashPassword } from "../src/auth/passwords";
import { verifyAndConsumeTicket } from "../src/ws/tickets";

describe("POST /auth/ws-ticket", () => {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: env.jwtSecret, sign: { expiresIn: "15m" } });
  app.register(authRoutes);

  afterAll(async () => {
    await app.close();
  });

  it("requires a JWT and returns a consumable ticket for request.user.sub", async () => {
    await app.ready();

    const missing = await app.inject({
      method: "POST",
      url: "/auth/ws-ticket",
    });
    expect(missing.statusCode).toBe(401);

    const suffix = Date.now();
    const user = await createUser(
      `ws-ticket-${suffix}@example.com`,
      `ws_ticket_${suffix}`,
      await hashPassword("correcthorsebattery"),
    );
    const accessToken = app.jwt.sign({ sub: String(user.id) });

    const ok = await app.inject({
      method: "POST",
      url: "/auth/ws-ticket",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { ticket: string };
    expect(body.ticket).toBeTruthy();

    await expect(verifyAndConsumeTicket(body.ticket)).resolves.toEqual({
      userId: String(user.id),
    });
  });
});
