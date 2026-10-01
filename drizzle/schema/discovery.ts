/** Alpha candidates (historical Solana archive table). */
import { boolean, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * A fresh pump.fun mint that passed the house's own Sniper entry criteria
 * (lib/sniper/safety-checks.ts#evaluateSafety against the house base
 * config) — populated by scripts/paper-daemon.ts, which already fetches
 * the shared per-token safety data for its per-user evaluation loop and
 * reuses it here rather than re-fetching. Chain-wide, not wallet-scoped —
 * this is a discovery feed (the "Alpha" page), not a per-bot ledger.
 */
export const alphaCandidates = pgTable(
  "alpha_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    token: text("token").notNull().unique(), // mint address
    /* PR04 chain-neutral successor + chain discriminator — schema
     * foundation only, per the migration plan; discovery/safety logic is
     * unchanged in this PR (that's PR05/PR06). */
    tokenAddress: text("token_address"),
    chain: text("chain"), // "solana" | "robinhood" | null (not yet backfilled)
    network: text("network"), // "testnet" | "mainnet" | null — see trades.network
    symbol: text("symbol"),
    name: text("name"),
    /* Normalized ticker (see lib/sniper/alpha-candidates.ts#symbolKeyFor),
       UNIQUE so the first mint to claim a ticker keeps it and every later
       copy is rejected by the database rather than by application logic.
       pump.fun tickers are permissionless and duplicate launches are the
       dominant spam pattern here: measured live, 756 recorded candidates
       collapsed to 258 distinct tickers, and campaigns re-used one ticker
       under several different names to evade a name-based filter. Nullable
       on purpose — Postgres allows many NULLs under a unique index, so
       tokens with no ticker never collide with each other. */
    symbolKey: text("symbol_key"),
    ageSec: numeric("age_sec").notNull(), // age at the moment it was evaluated
    creatorBuyPct: numeric("creator_buy_pct"),
    mintAuthorityRenounced: boolean("mint_authority_renounced"),
    freezeAuthorityRenounced: boolean("freeze_authority_renounced"),
    hasSocialLink: boolean("has_social_link"),
    /** Full SafetyCheckResult (lib/sniper/safety-checks.ts) — metadata,
     * reasons, alpha-wallet fields — kept as-is for the UI to render
     * without duplicating columns for every field. */
    safety: jsonb("safety").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("alpha_candidates_detected_idx").on(table.detectedAt),
    uniqueIndex("alpha_candidates_symbol_key_idx").on(table.symbolKey),
  ]
);

export type AlphaCandidate = typeof alphaCandidates.$inferSelect;
