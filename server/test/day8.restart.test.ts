import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { findMatchByGameId, findMatchRounds } from "../src/db/matches";
import { createRedisGameSessionStore } from "../src/redis/gameSessionStore";
import { scripted } from "./helpers/cards";
import { deleteTestUsers, matchCountFor } from "./helpers/db";
import { isolatedRedis } from "./helpers/redis";
import { eventually, playRounds, TestClient } from "./helpers/ws";

const serverDir = resolve(__dirname, "..");
const redis = isolatedRedis();
const sessions = createRedisGameSessionStore(redis.client);
const createdUsers: string[] = [];
const processes = new Set<ChildProcess>();

interface ServerProcess {
  child: ChildProcess;
  port: number;
  output: string[];
  kill(): Promise<NodeJS.Signals | null>;
}

interface Account {
  id: string;
  email: string;
  password: string;
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        fail(new Error("expected a TCP address"));
        return;
      }
      probe.close(() => done(address.port));
    });
  });
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function startServer(port: number): Promise<ServerProcess> {
  const output: string[] = [];
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port), REDIS_URL: redis.url },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.add(child);
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  const exited = new Promise<NodeJS.Signals | null>((done) => {
    child.once("exit", (_code, signal) => {
      processes.delete(child);
      done(signal);
    });
  });

  const deadline = Date.now() + 20_000;
  while (!(await isHealthy(port))) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`server exited during startup:\n${output.join("")}`);
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`server never became healthy:\n${output.join("")}`);
    }
    await new Promise((wait) => setTimeout(wait, 100));
  }

  return {
    child,
    port,
    output,
    kill() {
      child.kill("SIGKILL");
      return exited;
    },
  };
}

async function post(
  port: number,
  path: string,
  body?: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function register(port: number): Promise<Account> {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const account = {
    email: `day8-${tag}@test.local`,
    username: `day8_${tag}`,
    password: "correct-horse-battery",
  };
  const response = await post(port, "/auth/register", account);
  expect(response.status).toBe(201);
  const user = (await response.json()) as { id: string | number };
  createdUsers.push(String(user.id));
  return {
    id: String(user.id),
    email: account.email,
    password: account.password,
  };
}

async function login(port: number, account: Account): Promise<string> {
  const response = await post(port, "/auth/login", {
    email: account.email,
    password: account.password,
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

async function ratingOverHttp(port: number, account: Account): Promise<number> {
  const token = await login(port, account);
  const response = await fetch(`http://127.0.0.1:${port}/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { rating: number }).rating;
}

async function joinGame(
  port: number,
  account: Account,
  gameId: string,
): Promise<TestClient> {
  const token = await login(port, account);
  const response = await post(port, "/auth/ws-ticket", undefined, token);
  expect(response.status).toBe(200);
  const { ticket } = (await response.json()) as { ticket: string };
  const client = await TestClient.connect(
    `ws://127.0.0.1:${port}/ws?ticket=${ticket}`,
  );
  client.send({ type: "game:join", gameId });
  await client.next("game:joined");
  return client;
}

afterEach(async () => {
  for (const child of processes) child.kill("SIGKILL");
});

afterAll(async () => {
  await deleteTestUsers(createdUsers);
  await redis.cleanup();
});

describe("day 8 restart", () => {
  it("loses no finished match when the server process is killed and restarted", async () => {
    const port = await freePort();
    let server = await startServer(port);
    const alice = await register(port);
    const bob = await register(port);
    expect(await ratingOverHttp(port, alice)).toBe(1000);

    const game = await sessions.create({
      player1UserId: alice.id,
      player2UserId: bob.id,
      player1Deck: scripted.player1Deck,
      player2Deck: scripted.player2Deck,
    });
    const aliceClient = await joinGame(port, alice, game.id);
    const bobClient = await joinGame(port, bob, game.id);
    const results = await playRounds(
      game.id,
      { client: aliceClient },
      { client: bobClient, pick: scripted.player2Pick },
    );
    expect(results).toHaveLength(5);

    expect(await server.kill()).toBe("SIGKILL");
    expect(await isHealthy(port)).toBe(false);

    server = await startServer(port);
    const match = await eventually(() => findMatchByGameId(game.id), 10_000);
    expect(match).toMatchObject({
      player1_id: alice.id,
      player2_id: bob.id,
      winner_id: alice.id,
      rating_delta: 16,
      status: "finished",
    });
    const rounds = await findMatchRounds(match.id);
    expect(rounds.map((round) => round.round_no)).toEqual([1, 2, 3, 4, 5]);
    expect(rounds.map((round) => round.winner_id)).toEqual(
      scripted.roundWinners.map((seat) =>
        seat === "player1" ? alice.id : bob.id,
      ),
    );
    expect(rounds.map((round) => round.card1_id)).toEqual(
      results.map((result) => result.round.card1.ID),
    );
    expect(await ratingOverHttp(port, alice)).toBe(1016);
    expect(await ratingOverHttp(port, bob)).toBe(984);

    expect(await server.kill()).toBe("SIGKILL");
    server = await startServer(port);
    expect(await findMatchByGameId(game.id)).toEqual(match);
    expect(await findMatchRounds(match.id)).toEqual(rounds);
    expect(await ratingOverHttp(port, alice)).toBe(1016);
    expect(await ratingOverHttp(port, bob)).toBe(984);
    expect(await matchCountFor(alice.id)).toBe(1);
    await eventually(async () =>
      (await sessions.unpersisted()).includes(game.id) ? null : true,
    );

    await server.kill();
  }, 90_000);

  it("resumes a live game that was in Redis when the process was killed", async () => {
    const port = await freePort();
    let server = await startServer(port);
    const alice = await register(port);
    const bob = await register(port);
    const game = await sessions.create({
      player1UserId: alice.id,
      player2UserId: bob.id,
      player1Deck: scripted.player1Deck,
      player2Deck: scripted.player2Deck,
    });
    let aliceClient = await joinGame(port, alice, game.id);
    let bobClient = await joinGame(port, bob, game.id);
    await playRounds(
      game.id,
      { client: aliceClient },
      { client: bobClient, pick: scripted.player2Pick },
      1,
      3,
    );

    expect(await server.kill()).toBe("SIGKILL");
    expect(await findMatchByGameId(game.id)).toBeNull();
    expect((await sessions.get(game.id))?.state.round).toBe(4);

    server = await startServer(port);
    aliceClient = await joinGame(port, alice, game.id);
    bobClient = await joinGame(port, bob, game.id);
    expect((await aliceClient.next("game:state")).state.score).toBe(2);
    expect((await bobClient.next("game:state")).state.score).toBe(1);
    await playRounds(
      game.id,
      { client: aliceClient },
      { client: bobClient, pick: scripted.player2Pick },
      4,
      5,
    );

    const match = await eventually(() => findMatchByGameId(game.id), 10_000);
    expect(match.winner_id).toBe(alice.id);
    expect(await findMatchRounds(match.id)).toHaveLength(5);
    expect(await ratingOverHttp(port, alice)).toBe(1016);
    expect(await ratingOverHttp(port, bob)).toBe(984);

    await server.kill();
  }, 90_000);
});
