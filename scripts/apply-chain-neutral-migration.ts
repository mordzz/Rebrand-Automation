/**
 * Applies drizzle/0001_chain_neutral_foundation.sql against the
 * configured database (DIRECT_URL, falling back to DATABASE_URL — same
 * precedence drizzle.config.ts uses for migrations).
 *
 * The SQL itself is hand-authored and additive-only: ADD COLUMN IF NOT
 * EXISTS, plus a one-time historical backfill gated on a "_migrations"
 * marker row (not on column nullness — see the SQL file's comments for
 * why that distinction matters once real Robinhood rows exist).
 *
 * The row-count invariant check runs INSIDE the same transaction as the
 * migration itself: if any of the ledger/discovery tables' row counts
 * differ after applying, this throws *before* the transaction can
 * commit, so a destructive side effect is rolled back rather than merely
 * reported after the fact.
 *
 * Safe to re-run: the ALTER TABLE statements are idempotent, and the
 * historical backfill only runs once (see the marker table).
 *
 * Run: npm run migrate:chain-neutral
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const SQL_PATH = join(process.cwd(), "drizzle", "0001_chain_neutral_foundation.sql");

// Deliberately excludes "_migrations": that table gaining exactly one row
// on the first application is expected and is the mechanism this
// migration relies on, not a side effect to flag.
const LEDGER_TABLES = [
  "trades",
  "positions",
  "logs",
  "sniper_state",
  "sniper_config",
  "alpha_candidates",
] as const;

async function countRows(
  tx: postgres.TransactionSql,
  table: string
): Promise<number> {
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
      console.log("Row counts before (inside transaction):");
      const before = new Map<string, number>();
      for (const table of LEDGER_TABLES) {
        const count = await countRows(tx, table);
        before.set(table, count);
        console.log(`  ${table}: ${count}`);
      }

      console.log(`\nApplying ${SQL_PATH}...`);
      await tx.unsafe(migrationSql);
      console.log("Applied (not yet committed).\n");

      console.log("Row counts after (inside transaction, pre-commit):");
      const mismatches: string[] = [];
      for (const table of LEDGER_TABLES) {
        const count = await countRows(tx, table);
        console.log(`  ${table}: ${count}`);
        if (count !== before.get(table)) mismatches.push(table);
      }

      if (mismatches.length > 0) {
        // Throwing inside sql.begin() rolls the whole transaction back —
        // the ADD COLUMN / backfill statements above are undone too, not
        // just left uncommitted for someone to notice later.
        throw new Error(
          `Row counts changed in: ${mismatches.join(", ")}. This migration should only ` +
            `ADD/UPDATE columns, never insert or delete rows. Rolling back.`
        );
      }

      console.log("\nRow counts unchanged — safe to commit.");
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
