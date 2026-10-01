/** Historical Perpspad launch records (product paused). */
import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * One row per launched Perpspad token (app/perps). `programTokenPda` and
 * `driftSubaccountAuthority` are null while `status = "pending"` — a
 * Phase 0 row exists here before any on-chain program does; those columns
 * become real once the token is registered on-chain (see the Perpspad
 * plan). The `entryPrice`…`lastCheckedAt` block is keeper-refreshed and
 * volatile, same "keeper writes, page reads" shape as
 * positions.lastPrice/lastCheckedAt.
 */
export const perpspadTokens = pgTable(
  "perpspad_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /* Null while status = "pending" — Phase 0 rows record a creator's
       intent before any on-chain program exists to actually mint
       anything. Nullable + unique, same reasoning as
       alphaCandidates.symbolKey: Postgres allows many NULLs under a
       unique index, so pending rows never collide with each other. */
    mint: text("mint").unique(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    /* Drift's own numeric market index for the underlying — the program
       sends this to Drift directly, never a symbol string derived at
       call time. Display symbol lives in lib/perps/markets.ts. */
    underlyingMarketIndex: numeric("underlying_market_index").notNull(),
    direction: text("direction").notNull(), // LONG | SHORT
    targetLeverage: numeric("target_leverage").notNull(),
    creatorWallet: text("creator_wallet").notNull(),
    /* The on-chain PerpToken PDA address — the real source of truth once
       the Phase 1 program exists; unique so a chain account is never
       claimed by two rows. */
    programTokenPda: text("program_token_pda").unique(),
    /* This token's own Drift-authority PDA (Phase 2) — one distinct
       authority per token, never shared across tokens, so a bug reachable
       through one token's CPI logic can't reach another token's Drift
       account. */
    driftSubaccountAuthority: text("drift_subaccount_authority"),
    meteoraPoolAddress: text("meteora_pool_address"),
    // pending (Phase 0, no chain account yet) | active | low_health |
    // liquidated | accumulating
    status: text("status").notNull().default("pending"),
    entryPrice: numeric("entry_price"),
    currentPrice: numeric("current_price"),
    collateralUsdc: numeric("collateral_usdc"),
    healthRatio: numeric("health_ratio"),
    pendingFeesUsdc: numeric("pending_fees_usdc"),
    totalFeesCollectedUsdc: numeric("total_fees_collected_usdc")
      .notNull()
      .default("0"),
    totalBurnedTokens: numeric("total_burned_tokens").notNull().default("0"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("perpspad_tokens_status_created_idx").on(table.status, table.createdAt),
  ]
);

/**
 * Append-only audit ledger, one row per keeper fee-collection cycle for
 * one token — same role as `logs`/`sniperConfigHistory`. A cycle can
 * half-succeed (e.g. the collateral top-up lands but the buyback swap
 * fails); `status` records that honestly rather than treating the whole
 * cycle as atomic.
 */
export const perpspadFeeEvents = pgTable(
  "perpspad_fee_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => perpspadTokens.id, { onDelete: "cascade" }),
    claimedAmountUsdc: numeric("claimed_amount_usdc").notNull(),
    collateralTopUpAmountUsdc: numeric("collateral_top_up_amount_usdc"),
    tokenBuybackAmountUsdc: numeric("token_buyback_amount_usdc"),
    governanceBuybackAmountUsdc: numeric("governance_buyback_amount_usdc"),
    tokenBurnedAmount: numeric("token_burned_amount"),
    governanceBurnedAmount: numeric("governance_burned_amount"),
    claimTxSignature: text("claim_tx_signature"),
    topUpTxSignature: text("top_up_tx_signature"),
    tokenBuybackTxSignature: text("token_buyback_tx_signature"),
    governanceBuybackTxSignature: text("governance_buyback_tx_signature"),
    status: text("status").notNull().default("pending"), // pending | completed | partial | failed
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("perpspad_fee_events_token_created_idx").on(
      table.tokenId,
      table.createdAt
    ),
  ]
);

/**
 * Single-row, hot-reloadable Perpspad config — same shape/role as
 * sniperConfig. Basis points, not raw percent, because this mirrors what
 * the on-chain Config account (Phase 1) stores: **this row is the source
 * of truth only until that account exists** — from Phase 1 onward it
 * becomes a read-cache synced FROM chain, not an independently-editable
 * value, or the fee-split-duplicated-in-three-places bug the UI mockup
 * already had just moves on-chain instead of getting fixed. The CHECK
 * below is the DB half of that same invariant's belt-and-suspenders pair
 * (app half: lib/perps/fee-split.ts#assertValidFeeSplit), mirroring
 * userBots' isOfficial/user_bots_official_never_live pattern.
 */
export const perpspadConfig = pgTable(
  "perpspad_config",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    feeSplitCollateralBps: numeric("fee_split_collateral_bps")
      .notNull()
      .default("5000"),
    feeSplitTokenBurnBps: numeric("fee_split_token_burn_bps")
      .notNull()
      .default("2500"),
    feeSplitGovBurnBps: numeric("fee_split_gov_burn_bps")
      .notNull()
      .default("2500"),
    keeperIntervalMs: numeric("keeper_interval_ms").notNull().default("60000"),
    profitRealizationThresholdPct: numeric("profit_realization_threshold_pct")
      .notNull()
      .default("20"),
    minCollateralTopUpUsdc: numeric("min_collateral_top_up_usdc")
      .notNull()
      .default("1"),
  },
  () => [
    check(
      "perpspad_config_fee_split_sums_to_10000",
      sql`fee_split_collateral_bps + fee_split_token_burn_bps + fee_split_gov_burn_bps = 10000`
    ),
  ]
);

export type PerpspadToken = typeof perpspadTokens.$inferSelect;
export type PerpspadFeeEvent = typeof perpspadFeeEvents.$inferSelect;
export type PerpspadConfigRow = typeof perpspadConfig.$inferSelect;
