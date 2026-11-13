import { randomUUID } from "node:crypto";
import type pg from "pg";
import { pool } from "../../src/db/pool";

export interface TestUser {
  id: string;
  email: string;
  username: string;
}

export async function createTestUser(rating = 1000): Promise<TestUser> {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const res = await pool.query<{ id: string; email: string; username: string }>(
    `INSERT INTO users (email, username, password_hash, rating)
     VALUES ($1, $2, 'not-a-real-hash', $3)
     RETURNING id, email, username`,
    [`day8-${tag}@test.local`, `day8_${tag}`, rating],
  );
  const row = res.rows[0];
  return { id: String(row.id), email: row.email, username: row.username };
}

export async function ratingOf(userId: string): Promise<number> {
  const res = await pool.query<{ rating: number }>(
    `SELECT rating FROM users WHERE id = $1`,
    [userId],
  );
  return res.rows[0].rating;
}

export async function matchCountFor(userId: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT count(*) FROM matches WHERE player1_id = $1 OR player2_id = $1`,
    [userId],
  );
  return Number(res.rows[0].count);
}

export async function deleteTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await pool.query(
    `DELETE FROM matches
     WHERE player1_id = ANY($1::bigint[]) OR player2_id = ANY($1::bigint[])`,
    [userIds],
  );
  await pool.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [userIds]);
}

export function faultyPool(
  onQuery: (
    statement: { index: number; sql: string },
    client: pg.PoolClient,
  ) => void | Promise<void>,
): Pick<pg.Pool, "connect"> {
  const connect = async () => {
    const client = await pool.connect();
    let index = 0;
    return new Proxy(client, {
      get(target, property) {
        if (property === "query") {
          return async (sql: string, params?: unknown[]) => {
            if (sql !== "ROLLBACK") {
              await onQuery({ index: index++, sql }, target);
            }
            return target.query(sql, params);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return { connect } as unknown as Pick<pg.Pool, "connect">;
}
