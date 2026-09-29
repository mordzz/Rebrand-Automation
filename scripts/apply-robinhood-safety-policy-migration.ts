/**
 * Applies drizzle/0002_robinhood_safety_policy.sql against the configured
 * database (DIRECT_URL, falling back to DATABASE_URL). Purely additive
 * (ADD COLUMN IF NOT EXISTS) — no marker/backfill machinery needed here,
 * unlike scripts/apply-chain-neutral-migration.ts's PR04 migration, since
 * there's no historical-vs-new row distinction to get wrong: every row,
 * old or new, gets the same column defaults.
 *
 * The row-count invariant check runs INSIDE the same transaction as the
 * migration itself, same posture as PR04's apply script: if this ever
 * somehow changed row counts, that's caught before commit, not after.
 *
 * Safe to re-run any number of times.
 *
 * Run: npm run migrate:robinhood-safety-policy
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const SQL_PATH = join(process.cwd(), "drizzle", "0002_robinhood_safety_policy.sql");

async function countRows(tx: postgres.TransactionSql): Promise<number> {
  const [row] = await tx`select count(*)::int as c from sniper_config`;
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
      const before = await countRows(tx);
      console.log(`sniper_config row count before: ${before}`);

      console.log(`Applying ${SQL_PATH}...`);
      await tx.unsafe(migrationSql);

      const after = await countRows(tx);
      console.log(`sniper_config row count after: ${after}`);

      if (before !== after) {
        throw new Error(
          `Row count changed (${before} → ${after}) — this migration should only ADD columns. Rolling back.`
        );
      }
      console.log("Row count unchanged — safe to commit.");
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
