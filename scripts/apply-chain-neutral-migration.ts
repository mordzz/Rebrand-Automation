/**
 * Applies drizzle/0001_chain_neutral_foundation.sql against the
 * configured database (DIRECT_URL, falling back to DATABASE_URL — same
 * precedence drizzle.config.ts uses for migrations).
 *
 * The SQL itself is hand-authored and additive-only (ADD COLUMN IF NOT
 * EXISTS + UPDATE ... WHERE ... IS NULL) — this script just runs it
 * inside one transaction and reports before/after row counts so a
 * destructive migration would be obvious immediately, not just assumed
 * safe. Safe to re-run: every statement in the SQL file is idempotent.
 *
 * Run: npm run migrate:chain-neutral
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const SQL_PATH = join(process.cwd(), "drizzle", "0001_chain_neutral_foundation.sql");

const TABLES = [
  "trades",
  "positions",
  "logs",
  "sniper_state",
  "sniper_config",
  "alpha_candidates",
] as const;

async function countRows(sql: postgres.Sql, table: string): Promise<number> {
  const [row] = await sql.unsafe(`select count(*)::int as c from ${table}`);
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

  try {
    console.log("Row counts before:");
    const before = new Map<string, number>();
    for (const table of TABLES) {
      const count = await countRows(sql, table);
      before.set(table, count);
      console.log(`  ${table}: ${count}`);
    }

    const migrationSql = readFileSync(SQL_PATH, "utf8");
    console.log(`\nApplying ${SQL_PATH} in a single transaction...`);
    await sql.begin((tx) => tx.unsafe(migrationSql));
    console.log("Applied.\n");

    console.log("Row counts after:");
    let anyRowCountChanged = false;
    for (const table of TABLES) {
      const count = await countRows(sql, table);
      console.log(`  ${table}: ${count}`);
      if (count !== before.get(table)) anyRowCountChanged = true;
    }

    if (anyRowCountChanged) {
      console.error(
        "\n[!] Row counts changed — this migration should only ADD/UPDATE columns, " +
          "never insert or delete rows. Investigate before trusting this result."
      );
      process.exitCode = 1;
      return;
    }

    console.log("\nRow counts unchanged — migration was additive only, as expected.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
