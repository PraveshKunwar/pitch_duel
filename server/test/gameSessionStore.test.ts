import { afterAll, describe, expect, it } from "vitest";
import { resolveCurrentRound } from "../src/game/resolveCurrentRound";
import { submitPick } from "../src/game/submitPick";
import {
  createRedisGameSessionStore,
  gameStateKey,
  UNPERSISTED_GAMES_KEY,
  userGameKey,
} from "../src/redis/gameSessionStore";
import {
  createGameSessionStore,
  nextCategory,
  type GameSession,
  type GameSessionStore,
} from "../src/ws/gameSessions";
import { flatCard } from "./helpers/cards";
import { isolatedRedis } from "./helpers/redis";

const redis = isolatedRedis();

afterAll(async () => {
  await redis.cleanup();
});

function newGame(store: GameSessionStore, users = ["u1", "u2"]) {
  return store.create({
    player1UserId: users[0],
    player2UserId: users[1],
    player1Deck: [1, 2, 3, 4, 5].map((n) => flatCard(`a${n}`, 60)),
    player2Deck: [1, 2, 3, 4, 5].map((n) => flatCard(`b${n}`, 40)),
  });
}

async function finish(
  store: GameSessionStore,
  session: GameSession,
): Promise<GameSession> {
  let current = session;
  while (current.state.status !== "finished") {
    let state = current.state;
    state = submitPick(state, "player1", state.player1.hand[0].ID);
    state = submitPick(state, "player2", state.player2.hand[0].ID);
    state = resolveCurrentRound(state, nextCategory(state.category));
    const saved = await store.update({ ...current, state });
    if (!saved) throw new Error("unexpected write conflict");
    current = saved;
  }
  return current;
}

describe.each([
  ["in-memory", () => createGameSessionStore()],
  ["redis", () => createRedisGameSessionStore(redis.client)],
])("game session store (%s)", (_name, makeStore) => {
  it("returns exactly what was stored", async () => {
    const store = makeStore();
    const created = await newGame(store);

    expect(created.version).toBe(1);
    expect(created.deadlineMs).toBeNull();
    expect(created.state.player1.hand).toHaveLength(5);
    await expect(store.get(created.id)).resolves.toEqual(created);
  });

  it("returns null for a game that does not exist", async () => {
    await expect(makeStore().get("missing")).resolves.toBeNull();
  });

  it("keeps every part of a live game across a write", async () => {
    const store = makeStore();
    const created = await newGame(store);
    const cardId = created.state.player1.hand[2].ID;

    const saved = await store.update({
      ...created,
      state: submitPick(created.state, "player1", cardId),
      lastSequence: { player1: 7, player2: 0 },
      deadlineMs: 1_700_000_020_000,
    });

    expect(saved?.version).toBe(2);
    const loaded = await store.get(created.id);
    expect(loaded).toEqual(saved);
    expect(loaded?.state.player1.selectedCardId).toBe(cardId);
    expect(loaded?.state.player2.selectedCardId).toBeNull();
    expect(loaded?.lastSequence).toEqual({ player1: 7, player2: 0 });
    expect(loaded?.deadlineMs).toBe(1_700_000_020_000);
    expect(loaded?.player1UserId).toBe("u1");
    expect(loaded?.state.round).toBe(1);
    expect(loaded?.state.category).toBe("attack");
  });

  it("hands out copies, so mutating a read never changes the store", async () => {
    const store = makeStore();
    const created = await newGame(store);
    const loaded = await store.get(created.id);
    loaded?.state.player1.hand.pop();

    expect((await store.get(created.id))?.state.player1.hand).toHaveLength(5);
  });

  it("rejects a write based on a stale read", async () => {
    const store = makeStore();
    const created = await newGame(store);
    const first = { ...created, deadlineMs: 111 };
    const second = { ...created, deadlineMs: 222 };

    await expect(store.update(first)).resolves.toMatchObject({ version: 2 });
    await expect(store.update(second)).resolves.toBeNull();
    expect((await store.get(created.id))?.deadlineMs).toBe(111);
  });

  it("lets exactly one of many simultaneous writers win", async () => {
    const store = makeStore();
    const created = await newGame(store);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        store.update({ ...created, deadlineMs: n }),
      ),
    );

    const winners = results.filter((result) => result !== null);
    expect(winners).toHaveLength(1);
    const stored = await store.get(created.id);
    expect(stored?.version).toBe(2);
    expect(stored?.deadlineMs).toBe(winners[0]?.deadlineMs);
  });

  it("does not create a game by updating one that is missing", async () => {
    const store = makeStore();
    const created = await newGame(createGameSessionStore());

    await expect(store.update(created)).resolves.toBeNull();
    await expect(store.get(created.id)).resolves.toBeNull();
  });

  it("maps each player to their active game", async () => {
    const store = makeStore();
    const created = await newGame(store, ["map-1", "map-2"]);

    await expect(store.activeGameFor("map-1")).resolves.toBe(created.id);
    await expect(store.activeGameFor("map-2")).resolves.toBe(created.id);
    await expect(store.activeGameFor("map-3")).resolves.toBeNull();
  });

  it("lists a game as unpersisted from the moment it finishes", async () => {
    const store = makeStore();
    const created = await newGame(store, ["fin-1", "fin-2"]);
    expect(await store.unpersisted()).not.toContain(created.id);

    const finished = await finish(store, created);

    expect(finished.state.status).toBe("finished");
    expect(await store.unpersisted()).toContain(created.id);
    await expect(store.activeGameFor("fin-1")).resolves.toBe(created.id);
  });

  it("releases the game and its players once marked persisted", async () => {
    const store = makeStore();
    const created = await newGame(store, ["rel-1", "rel-2"]);
    await finish(store, created);

    await store.markPersisted(created.id, ["rel-1", "rel-2"]);

    expect(await store.unpersisted()).not.toContain(created.id);
    await expect(store.activeGameFor("rel-1")).resolves.toBeNull();
    await expect(store.activeGameFor("rel-2")).resolves.toBeNull();
    expect((await store.get(created.id))?.state.status).toBe("finished");
  });

  it("leaves a player's newer game alone when an older one is persisted", async () => {
    const store = makeStore();
    const older = await newGame(store, ["new-1", "new-2"]);
    await finish(store, older);
    const newer = await newGame(store, ["new-1", "new-3"]);

    await store.markPersisted(older.id, ["new-1", "new-2"]);

    await expect(store.activeGameFor("new-1")).resolves.toBe(newer.id);
    await expect(store.activeGameFor("new-2")).resolves.toBeNull();
  });

  it("opens the first round through the created listener", async () => {
    const store = makeStore();
    store.setOnCreated(async (session) => {
      await store.update({ ...session, deadlineMs: 20_000 });
    });

    const created = await newGame(store);

    expect(created.version).toBe(2);
    expect(created.deadlineMs).toBe(20_000);
  });
});

describe("redis game session store keys", () => {
  const store = createRedisGameSessionStore(redis.client);

  it("uses the planned keys and expires them", async () => {
    const created = await newGame(store, ["key-1", "key-2"]);

    await expect(redis.client.type(gameStateKey(created.id))).resolves.toBe(
      "hash",
    );
    expect(gameStateKey(created.id)).toBe(`game:${created.id}:state`);
    expect(userGameKey("key-1")).toBe("user:key-1:game");
    await expect(redis.client.get("user:key-1:game")).resolves.toBe(created.id);

    for (const key of [gameStateKey(created.id), userGameKey("key-1")]) {
      const ttl = await redis.client.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60 * 60);
    }
  });

  it("refreshes the TTL on every write to a live game", async () => {
    const created = await newGame(store);
    await redis.client.expire(gameStateKey(created.id), 5);

    await store.update({ ...created, deadlineMs: 1 });

    expect(await redis.client.ttl(gameStateKey(created.id))).toBeGreaterThan(5);
  });

  it("keeps an unpersisted game for a day, then minutes once persisted", async () => {
    const created = await newGame(store, ["ttl-1", "ttl-2"]);
    await finish(store, created);
    const key = gameStateKey(created.id);

    expect(await redis.client.ttl(key)).toBeGreaterThan(60 * 60);
    await expect(
      redis.client.sismember(UNPERSISTED_GAMES_KEY, created.id),
    ).resolves.toBe(1);

    await store.markPersisted(created.id, ["ttl-1", "ttl-2"]);

    const ttl = await redis.client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10 * 60);
  });
});
