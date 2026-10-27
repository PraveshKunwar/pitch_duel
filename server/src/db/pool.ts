import pg from "pg";
import { env } from "../config";

export const pool = new pg.Pool({ connectionString: env.databaseUrl });
