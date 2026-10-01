/**
 * Applies drizzle/0004_robinhood_agent_wallet.sql against the configured
 * database (DIRECT_URL, falling back to DATABASE_URL — same precedence
 * drizzle.config.ts uses for migrations).
 *
 * Same shape as scripts/apply-chain-neutral-migration.ts: additive-only
 * (ADD COLUMN IF NOT EXISTS) plus a one-time historical backfill gated on
 * the "_migrations" marker row, with a row-count invariant check run
 * INSIDE the same transaction so a destructive side effect (there should
 * be none — this migration never inserts/deletes user_bots rows) rolls
 * back before it can commit.
 *
 * Safe to re-run.
 *
 * Run: npm run migrate:robinhood-agent-wallet
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const SQL_PATH = join(process.cwd(), "drizzle", "0004_robinhood_agent_wallet.sql");

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
