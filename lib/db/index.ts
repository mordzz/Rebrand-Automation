import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/drizzle/schema";

type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Db };

/**
 * Lazy singleton. Returns null when DATABASE_URL is not configured so API
 * routes can degrade gracefully instead of crashing at import time.
 *
 * With Supabase, DATABASE_URL should be the transaction-mode pooler URL
 * (port 6543) — `prepare: false` is required in that mode.
 */
export function getDb(): Db | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!globalForDb.__db) {
    const client = postgres(url, { prepare: false, max: 5 });
    globalForDb.__db = drizzle(client, { schema });
  }
  return globalForDb.__db;
}
