/** Migration bookkeeping (hand-authored migrations in drizzle/*.sql). */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * One-time-migration marker table (drizzle/0001_chain_neutral_foundation.sql
 * and any future hand-authored migration in the same style). Declared here
 * so `drizzle-kit push` recognizes it as intentional rather than proposing
 * to drop it as schema drift.
 */
export const migrations = pgTable("_migrations", {
  name: text("name").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
