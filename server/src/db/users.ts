import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "./pool";

const refreshTtlMs = 30 * 24 * 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function refreshExpiry(): Date {
  return new Date(Date.now() + refreshTtlMs);
}

export async function createUser(
  email: string,
  username: string,
  passwordHash: string,
) {
  const text = `INSERT INTO users(email, username, password_hash)
    VALUES ($1, $2, $3)
    RETURNING id, email, username, rating
    `;
  const res = await pool.query(text, [email, username, passwordHash]);
  return res.rows[0];
}

export async function findUserByEmail(email: string) {
  const text = `SELECT id, email, username, password_hash, rating FROM users WHERE email = $1`;
  const res = await pool.query(text, [email]);
  return res.rows[0] ?? null;
}

export async function findUserById(id: string) {
  const text = `SELECT id, email, username, rating FROM users WHERE id = $1`;
  const res = await pool.query(text, [id]);
  return res.rows[0] ?? null;
}

export async function findUsersByIds(
  ids: string[],
): Promise<Array<{ id: string; username: string; rating: number }>> {
  if (ids.length === 0) return [];
  const res = await pool.query<{
    id: string;
    username: string;
    rating: number;
  }>(
    `SELECT id, username, rating
     FROM users
     WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  return res.rows.map((row) => ({
    id: String(row.id),
    username: row.username,
    rating: Number(row.rating),
  }));
}

export async function createRefreshToken(userId: string) {
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = refreshExpiry();
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, family_id)
     VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(rawToken), expiresAt, randomUUID()],
  );
  return { rawToken, expiresAt };
}

export type RefreshRotation =
  | { status: "ok"; rawToken: string; expiresAt: Date; userId: string }
  | { status: "invalid" }
  | { status: "reused" };

export async function revokeRefreshFamily(rawToken: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens
     SET revoked_at = now()
     WHERE family_id = (
       SELECT family_id FROM refresh_tokens WHERE token_hash = $1
     )
     AND revoked_at IS NULL`,
    [hashToken(rawToken)],
  );
}

export async function rotateRefreshToken(rawToken: string): Promise<RefreshRotation> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id, user_id, expires_at, revoked_at, replaced_by, family_id
       FROM refresh_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [hashToken(rawToken)],
    );
    const current = found.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return { status: "invalid" };
    }

    if (current.replaced_by !== null) {
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = now()
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [current.family_id],
      );
      await client.query("COMMIT");
      return { status: "reused" };
    }

    if (current.revoked_at !== null || current.expires_at <= new Date()) {
      await client.query("ROLLBACK");
      return { status: "invalid" };
    }

    const nextRawToken = randomBytes(32).toString("base64url");
    const expiresAt = refreshExpiry();
    const inserted = await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, family_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [current.user_id, hashToken(nextRawToken), expiresAt, current.family_id],
    );
    await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = now(), replaced_by = $1
       WHERE id = $2`,
      [inserted.rows[0].id, current.id],
    );
    await client.query("COMMIT");
    return {
      status: "ok",
      rawToken: nextRawToken,
      expiresAt,
      userId: String(current.user_id),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
