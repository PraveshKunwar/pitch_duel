import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "./pool";

async function main(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = resolve(__dirname, "migrations");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const existing = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
    if (existing.rowCount) continue;

    const sql = await readFile(resolve(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
