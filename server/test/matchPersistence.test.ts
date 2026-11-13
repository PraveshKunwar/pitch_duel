import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  findMatchByGameId,
  findMatchRounds,
  recordFinishedMatch,
  type FinishedMatch,
} from "../src/db/matches";
import { pool } from "../src/db/pool";
import {
  createTestUser,
  deleteTestUsers,
  faultyPool,
  matchCountFor,
  ratingOf,
  type TestUser,
} from "./helpers/db";

const created: string[] = [];

async function user(rating = 1000): Promise<TestUser> {
  const made = await createTestUser(rating);
  created.push(made.id);
  return made;
}

afterAll(async () => {
  await deleteTestUsers(created);
});

function finishedMatch(
  player1: TestUser,
  player2: TestUser,
  overrides: Partial<FinishedMatch> = {},
): FinishedMatch {
  const stats = [
    "attack",
    "defending",
    "passing",
    "attack",
    "defending",
  ] as const;
  return {
    gameId: randomUUID(),
    player1Id: player1.id,
    player2Id: player2.id,
    winner: "player1",
    startedAt: new Date("2026-11-02T18:00:00.000Z"),
    endedAt: new Date("2026-11-02T18:01:40.000Z"),
    rounds: stats.map((stat, index) => ({
      roundNo: index + 1,
      stat,
      card1Id: `p1-card-${index + 1}`,
      card2Id: `p2-card-${index + 1}`,
      winner: index % 2 === 0 ? "player1" : "player2",
    })),
    ...overrides,
  };
}

describe("recordFinishedMatch", () => {
  it("stores the match with its players, winner, delta, status, and times", async () => {
    const [p1, p2] = [await user(1200), await user(1000)];
    const match = finishedMatch(p1, p2);

    const recorded = await recordFinishedMatch(match);

    const row = await findMatchByGameId(match.gameId);
    expect(row).toMatchObject({
      id: recorded.matchId,
      game_id: match.gameId,
      player1_id: p1.id,
      player2_id: p2.id,
      winner_id: p1.id,
      rating_delta: 8,
      status: "finished",
    });
    expect(row?.started_at.toISOString()).toBe("2026-11-02T18:00:00.000Z");
    expect(row?.ended_at?.toISOString()).toBe("2026-11-02T18:01:40.000Z");
  });

  it("stores all five rounds with stat, both cards, and the round winner", async () => {
    const [p1, p2] = [await user(), await user()];
    const match = finishedMatch(p1, p2);

    const { matchId } = await recordFinishedMatch(match);

    expect(await findMatchRounds(matchId)).toEqual([
      {
        match_id: matchId,
        round_no: 1,
        stat: "attack",
        card1_id: "p1-card-1",
        card2_id: "p2-card-1",
        winner_id: p1.id,
      },
      {
        match_id: matchId,
        round_no: 2,
        stat: "defending",
        card1_id: "p1-card-2",
        card2_id: "p2-card-2",
        winner_id: p2.id,
      },
      {
        match_id: matchId,
        round_no: 3,
        stat: "passing",
        card1_id: "p1-card-3",
        card2_id: "p2-card-3",
        winner_id: p1.id,
      },
      {
        match_id: matchId,
        round_no: 4,
        stat: "attack",
        card1_id: "p1-card-4",
        card2_id: "p2-card-4",
        winner_id: p2.id,
      },
      {
        match_id: matchId,
        round_no: 5,
        stat: "defending",
        card1_id: "p1-card-5",
        card2_id: "p2-card-5",
        winner_id: p1.id,
      },
    ]);
  });

  it("moves both ratings by the Elo delta", async () => {
    const [p1, p2] = [await user(1200), await user(1000)];

    const recorded = await recordFinishedMatch(finishedMatch(p1, p2));

    expect(recorded).toMatchObject({
      winnerId: p1.id,
      ratingDelta: 8,
      ratings: { player1: 1208, player2: 992 },
      alreadyRecorded: false,
    });
    expect(await ratingOf(p1.id)).toBe(1208);
    expect(await ratingOf(p2.id)).toBe(992);
  });

  it("pays the underdog more when player 2 wins", async () => {
    const [p1, p2] = [await user(1400), await user(1000)];

    const recorded = await recordFinishedMatch(
      finishedMatch(p1, p2, { winner: "player2" }),
    );

    expect(recorded.winnerId).toBe(p2.id);
    expect(recorded.ratingDelta).toBe(29);
    expect(await ratingOf(p1.id)).toBe(1371);
    expect(await ratingOf(p2.id)).toBe(1029);
  });

  it("records a game once, however many times it is submitted", async () => {
    const [p1, p2] = [await user(), await user()];
    const match = finishedMatch(p1, p2);

    const first = await recordFinishedMatch(match);
    const second = await recordFinishedMatch(match);

    expect(first.alreadyRecorded).toBe(false);
    expect(second).toEqual({ ...first, alreadyRecorded: true });
    expect(await ratingOf(p1.id)).toBe(1016);
    expect(await ratingOf(p2.id)).toBe(984);
    expect(await matchCountFor(p1.id)).toBe(1);
  });

  it("records a game once when submitted twice at the same moment", async () => {
    const [p1, p2] = [await user(), await user()];
    const match = finishedMatch(p1, p2);

    const results = await Promise.all([
      recordFinishedMatch(match),
      recordFinishedMatch(match),
      recordFinishedMatch(match),
    ]);

    expect(results.filter((r) => !r.alreadyRecorded)).toHaveLength(1);
    expect(await ratingOf(p1.id)).toBe(1016);
    expect(await ratingOf(p2.id)).toBe(984);
    expect(await matchCountFor(p1.id)).toBe(1);
  });

  it("does not lose an update when one player finishes two games at once", async () => {
    const [shared, b, c] = [await user(), await user(), await user()];

    await Promise.all([
      recordFinishedMatch(finishedMatch(shared, b)),
      recordFinishedMatch(finishedMatch(c, shared, { winner: "player2" })),
    ]);

    expect(await ratingOf(shared.id)).toBe(1031);
    expect((await ratingOf(b.id)) + (await ratingOf(c.id))).toBe(2000 - 31);
    expect(await matchCountFor(shared.id)).toBe(2);
  });

  it("does not deadlock when the same two players finish opposite games", async () => {
    const [a, b] = [await user(), await user()];

    await Promise.all([
      recordFinishedMatch(finishedMatch(a, b)),
      recordFinishedMatch(finishedMatch(b, a)),
    ]);

    const ratings = [await ratingOf(a.id), await ratingOf(b.id)];
    expect(ratings.sort((x, y) => x - y)).toEqual([999, 1001]);
  });

  it("refuses a match whose player does not exist", async () => {
    const p1 = await user();
    const ghost: TestUser = { id: "999999999999", email: "", username: "" };

    await expect(recordFinishedMatch(finishedMatch(p1, ghost))).rejects.toThrow(
      /Players not found/,
    );
    expect(await ratingOf(p1.id)).toBe(1000);
  });
});

describe("atomic match end", () => {
  async function expectNoTrace(
    match: FinishedMatch,
    p1: TestUser,
    p2: TestUser,
  ) {
    expect(await ratingOf(p1.id)).toBe(1200);
    expect(await ratingOf(p2.id)).toBe(1000);
    expect(await findMatchByGameId(match.gameId)).toBeNull();
    expect(await matchCountFor(p1.id)).toBe(0);
    const rounds = await pool.query(
      `SELECT 1 FROM match_rounds WHERE winner_id IN ($1, $2)`,
      [p1.id, p2.id],
    );
    expect(rounds.rowCount).toBe(0);
  }

  const steps = [
    [1, "locking both rating rows"],
    [2, "checking for an existing match"],
    [3, "updating the winner's rating"],
    [4, "updating the loser's rating"],
    [5, "inserting the match"],
    [6, "inserting the rounds"],
    [7, "committing"],
  ] as const;

  it.each(steps)(
    "leaves no trace when the database fails at statement %i (%s)",
    async (failAt) => {
      const [p1, p2] = [await user(1200), await user(1000)];
      const match = finishedMatch(p1, p2);
      const db = faultyPool(({ index }) => {
        if (index === failAt) throw new Error("injected database failure");
      });

      await expect(recordFinishedMatch(match, db)).rejects.toThrow(
        "injected database failure",
      );

      await expectNoTrace(match, p1, p2);
    },
  );

  it("undoes a rating that was already updated when the next step fails", async () => {
    const [p1, p2] = [await user(1200), await user(1000)];
    const match = finishedMatch(p1, p2);
    let winnerRatingInsideTransaction: number | undefined;
    const db = faultyPool(async ({ index }, client) => {
      if (index !== 4) return;
      const seen = await client.query<{ rating: number }>(
        `SELECT rating FROM users WHERE id = $1`,
        [p1.id],
      );
      winnerRatingInsideTransaction = seen.rows[0].rating;
      throw new Error("injected database failure");
    });

    await expect(recordFinishedMatch(match, db)).rejects.toThrow("injected");

    expect(winnerRatingInsideTransaction).toBe(1208);
    await expectNoTrace(match, p1, p2);
  });

  it("rolls back when Postgres itself rejects the last statement", async () => {
    const [p1, p2] = [await user(1200), await user(1000)];
    const match = finishedMatch(p1, p2);
    match.rounds[3] = { ...match.rounds[3], roundNo: 3 };

    await expect(recordFinishedMatch(match)).rejects.toThrow(
      /match_rounds_pkey/,
    );

    await expectNoTrace(match, p1, p2);
  });

  it("returns the connection to the pool after a failure", async () => {
    const [p1, p2] = [await user(1200), await user(1000)];
    const idleBefore = pool.idleCount;
    const waitingBefore = pool.waitingCount;
    const db = faultyPool(({ index }) => {
      if (index === 5) throw new Error("injected database failure");
    });

    await expect(
      recordFinishedMatch(finishedMatch(p1, p2), db),
    ).rejects.toThrow("injected");

    expect(pool.waitingCount).toBe(waitingBefore);
    expect(pool.idleCount).toBeGreaterThanOrEqual(idleBefore);
    const recorded = await recordFinishedMatch(finishedMatch(p1, p2));
    expect(recorded.ratings).toEqual({ player1: 1208, player2: 992 });
  });
});
