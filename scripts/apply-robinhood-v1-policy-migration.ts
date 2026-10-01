/**
 * Applies drizzle/0003_robinhood_v1_policy.sql - backfills the approved
 * Robinhood v1 maxCreatorHoldPct default (10) into existing unconfigured
 * (NULL) sniper_config rows and sets the column's future default.
 *
 * Same transactional row-count-invariant posture as the other apply-*
 * scripts here: the check runs inside the same transaction as the
 * migration, so a genuine problem is caught before commit.
 *
 * Safe to re-run: the backfill only targets rows still NULL (already-
 * configured rows are untouched), and the ALTER COLUMN SET DEFAULT is
 * itself idempotent.
 *
 * Run: npm run migrate:robinhood-v1-policy
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const SQL_PATH = join(process.cwd(), "drizzle", "0003_robinhood_v1_policy.sql");

async function countRows(tx: postgres.TransactionSql): Promise<number> {
  const [row] = await tx`select count(*)::int as c from sniper_config`;
  return row.c as number;
}

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DIRECT_URL/DATABASE_URL not set - nothing to migrate against.");
    process.exitCode = 1;
    return;
  }

  const sql = postgres(connectionString);
  const migrationSql = readFileSync(SQL_PATH, "utf8");

  try {
    await sql.begin(async (tx) => {
      const before = await countRows(tx);
      console.log(`sniper_config row count before: ${before}`);

      console.log(`Applying ${SQL_PATH}...`);
      await tx.unsafe(migrationSql);

      const after = await countRows(tx);
      console.log(`sniper_config row count after: ${after}`);

      if (before !== after) {
        throw new Error(
          `Row count changed (${before} → ${after}) - this migration should only UPDATE/ALTER, never insert or delete rows. Rolling back.`
        );
      }
      console.log("Row count unchanged - safe to commit.");
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
