import { pool } from "./pool";

export async function createUser(
  email: string,
  username: string,
  passwordHash: string,
) {
  const text = `INSERT INTO users(username, email, password_hash)
    VALUES ($1, $2, $3)
    RETURNING id, email, username, rating
    `;
  const res = await pool.query(text, [email, username, passwordHash]);
  return res.rows[0];
}

export async function findUserByEmail(email: string) {
  const text = `SELECT id, email, username, password_hash FROM users WHERE email = $1`;
  const res = await pool.query(text, [email]);
  return res ? res.rows[0] : null;
}

export async function findUserById(id: string) {
  const text = `SELECT id, email, username, rating, created_at FROM users WHERE id = $1`;
  const res = await pool.query(text, [id]);
  return res.rows[0] ?? null;
}
