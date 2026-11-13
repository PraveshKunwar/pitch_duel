import type pg from "pg";
import { applyElo } from "../game/elo";
import type { MatchRoundSummary } from "../game/matchResult";
import { pool } from "./pool";

type Seat = "player1" | "player2";

export interface FinishedMatch {
  gameId: string;
  player1Id: string;
  player2Id: string;
  winner: Seat;
  startedAt: Date;
  endedAt: Date;
  rounds: MatchRoundSummary[];
}

export interface RecordedMatch {
  matchId: string;
  winnerId: string;
  ratingDelta: number;
  ratings: Record<Seat, number>;
  alreadyRecorded: boolean;
}

export async function recordFinishedMatch(
  match: FinishedMatch,
  db: Pick<pg.Pool, "connect"> = pool,
): Promise<RecordedMatch> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const locked = await client.query<{ id: string; rating: number }>(
      `SELECT id, rating
       FROM users
       WHERE id IN ($1, $2)
       ORDER BY id
       FOR UPDATE`,
      [match.player1Id, match.player2Id],
    );
    const ratingOf = new Map(
      locked.rows.map((row) => [String(row.id), row.rating]),
    );
    const player1Rating = ratingOf.get(match.player1Id);
    const player2Rating = ratingOf.get(match.player2Id);
    if (player1Rating === undefined || player2Rating === undefined) {
      throw new Error(`Players not found for game ${match.gameId}`);
    }

    const existing = await client.query<{
      id: string;
      winner_id: string;
      rating_delta: number;
    }>(`SELECT id, winner_id, rating_delta FROM matches WHERE game_id = $1`, [
      match.gameId,
    ]);
    const previous = existing.rows[0];
    if (previous) {
      await client.query("ROLLBACK");
      return {
        matchId: String(previous.id),
        winnerId: String(previous.winner_id),
        ratingDelta: previous.rating_delta,
        ratings: { player1: player1Rating, player2: player2Rating },
        alreadyRecorded: true,
      };
    }

    const player1Won = match.winner === "player1";
    const winnerId = player1Won ? match.player1Id : match.player2Id;
    const loserId = player1Won ? match.player2Id : match.player1Id;
    const elo = applyElo(
      player1Won ? player1Rating : player2Rating,
      player1Won ? player2Rating : player1Rating,
    );

    await client.query(`UPDATE users SET rating = $2 WHERE id = $1`, [
      winnerId,
      elo.winnerRating,
    ]);
    await client.query(`UPDATE users SET rating = $2 WHERE id = $1`, [
      loserId,
      elo.loserRating,
    ]);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO matches
         (game_id, player1_id, player2_id, winner_id, rating_delta,
          status, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, 'finished', $6, $7)
       RETURNING id`,
      [
        match.gameId,
        match.player1Id,
        match.player2Id,
        winnerId,
        elo.delta,
        match.startedAt,
        match.endedAt,
      ],
    );
    const matchId = String(inserted.rows[0].id);

    await client.query(
      `INSERT INTO match_rounds
         (match_id, round_no, stat, card1_id, card2_id, winner_id)
       SELECT $1, round_no, stat, card1_id, card2_id, winner_id
       FROM unnest($2::smallint[], $3::text[], $4::text[], $5::text[], $6::bigint[])
         AS r(round_no, stat, card1_id, card2_id, winner_id)`,
      [
        matchId,
        match.rounds.map((round) => round.roundNo),
        match.rounds.map((round) => round.stat),
        match.rounds.map((round) => round.card1Id),
        match.rounds.map((round) => round.card2Id),
        match.rounds.map((round) =>
          round.winner === "player1" ? match.player1Id : match.player2Id,
        ),
      ],
    );

    await client.query("COMMIT");
    return {
      matchId,
      winnerId,
      ratingDelta: elo.delta,
      ratings: {
        player1: player1Won ? elo.winnerRating : elo.loserRating,
        player2: player1Won ? elo.loserRating : elo.winnerRating,
      },
      alreadyRecorded: false,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface MatchRow {
  id: string;
  game_id: string;
  player1_id: string;
  player2_id: string;
  winner_id: string | null;
  rating_delta: number | null;
  status: "active" | "finished" | "abandoned";
  started_at: Date;
  ended_at: Date | null;
}

export interface MatchRoundRow {
  match_id: string;
  round_no: number;
  stat: string;
  card1_id: string;
  card2_id: string;
  winner_id: string;
}

export async function findMatchByGameId(
  gameId: string,
): Promise<MatchRow | null> {
  const res = await pool.query<MatchRow>(
    `SELECT id, game_id, player1_id, player2_id, winner_id, rating_delta,
            status, started_at, ended_at
     FROM matches
     WHERE game_id = $1`,
    [gameId],
  );
  return res.rows[0] ?? null;
}

export async function findMatchRounds(
  matchId: string,
): Promise<MatchRoundRow[]> {
  const res = await pool.query<MatchRoundRow>(
    `SELECT match_id, round_no, stat, card1_id, card2_id, winner_id
     FROM match_rounds
     WHERE match_id = $1
     ORDER BY round_no`,
    [matchId],
  );
  return res.rows;
}
