/**
 * Applies drizzle/0005_lighter_api_credentials.sql (DIRECT_URL, falling back
 * to DATABASE_URL). Additive-only (ADD COLUMN IF NOT EXISTS), no backfill;
 * the user_bots row-count invariant is checked inside the transaction so any
 * unexpected insert/delete rolls back. Safe to re-run.
 *
 * Run: npm run migrate:lighter-api-credentials
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const SQL_PATH = join(process.cwd(), "drizzle", "0005_lighter_api_credentials.sql");

async function countRows(tx: postgres.TransactionSql, table: string): Promise<number> {
  const [row] = await tx.unsafe(`select count(*)::int as c from ${table}`);
  return row.c as number;
}

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DIRECT_URL/DATABASE_URL not set — nothing to migrate against.");
    process.exitCode = 1;
    return;
  }

  const sql = postgres(connectionString);
  const migrationSql = readFileSync(SQL_PATH, "utf8");

  try {
    await sql.begin(async (tx) => {
      const before = await countRows(tx, "user_bots");
      console.log(`user_bots row count before: ${before}`);

      console.log(`\nApplying ${SQL_PATH}...`);
      await tx.unsafe(migrationSql);
      console.log("Applied (not yet committed).\n");

      const after = await countRows(tx, "user_bots");
      console.log(`user_bots row count after: ${after}`);

      if (after !== before) {
        throw new Error(
          `user_bots row count changed (${before} -> ${after}). This migration should only ` +
            `ADD/UPDATE columns, never insert or delete rows. Rolling back.`
        );
      }

      console.log("\nRow count unchanged — safe to commit.");
    });

    console.log("Transaction committed.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Migration failed (rolled back):", error);
  process.exitCode = 1;
});
