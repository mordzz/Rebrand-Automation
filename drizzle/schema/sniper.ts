/** House sniper config/state (the retired Solana house engine wrote sniper_state). */
import { boolean, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { lessons } from "./learning";

/**
 * Single-row control/heartbeat table for the standalone sniper daemon
 * (scripts/sniper-daemon.ts). Read by app/api/sniper/status and
 * app/api/sniper/toggle; written by the daemon itself.
 */
export const sniperState = pgTable("sniper_state", {
  id: uuid("id").defaultRandom().primaryKey(),
  mode: text("mode").notNull().default("dry_run"), // dry_run | live
  tradingPaused: boolean("trading_paused").notNull().default(false),
  pauseReason: text("pause_reason"),
  consecutiveLosses: numeric("consecutive_losses").notNull().default("0"),
  dailyPnlSol: numeric("daily_pnl_sol").notNull().default("0"),
  /* PR04 chain-neutral successor — see trades.sizeNative above for the
   * additive rationale. dailyPnlSol stays authoritative until a later PR
   * moves the daemon's reads/writes over. */
  dailyPnlNative: numeric("daily_pnl_native"),
  nativeSymbol: text("native_symbol"),
  dailyPnlResetAt: timestamp("daily_pnl_reset_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
  /* Set on every closed loss — canOpenNewPosition rejects new entries
     until sniperConfig.cooldownAfterLossSec has elapsed since this. */
  lastLossAt: timestamp("last_loss_at", { withTimezone: true }),
});

/**
 * Single-row, hot-reloadable trading configuration for the Sniper daemon —
 * replaces the old env-only SNIPER_* knobs (lib/sniper/config.ts). The
 * daemon re-reads this every cycle (getSniperConfig), so a change here
 * takes effect without a restart. SNIPER_ENABLED/SNIPER_DRY_RUN stay
 * env-only and restart-gated on purpose — those are master safety
 * switches, not trading behavior.
 */
export const sniperConfig = pgTable("sniper_config", {
  id: uuid("id").defaultRandom().primaryKey(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  // Entry filters (lib/sniper/safety-checks.ts)
  requireMintAuthorityRenounced: boolean("require_mint_authority_renounced")
    .notNull()
    .default(true),
  requireFreezeAuthorityRenounced: boolean("require_freeze_authority_renounced")
    .notNull()
    .default(true),
  requireSocialLink: boolean("require_social_link").notNull().default(true),
  /* Requires an on-chain-confirmed buy from one of `alphaWallets` before
     entering — see lib/sniper/alpha-wallets.ts. A no-op while alphaWallets
     is empty (never rejects everything just because the list is unset). */
  requireAlphaWalletBuy: boolean("require_alpha_wallet_buy")
    .notNull()
    .default(false),
  alphaWallets: jsonb("alpha_wallets").$type<string[]>().notNull().default([]),
  maxCreatorBuyPct: numeric("max_creator_buy_pct").notNull().default("10"),
  minTokenAgeSec: numeric("min_token_age_sec").notNull().default("0"),
  maxTokenAgeSec: numeric("max_token_age_sec"), // null = no ceiling
  blockedKeywords: jsonb("blocked_keywords")
    .$type<string[]>()
    .notNull()
    .default([]),

  // Sizing (lib/sniper/risk-limits.ts)
  maxSolPerSnipe: numeric("max_sol_per_snipe").notNull().default("0.05"),
  maxConcurrentPositions: numeric("max_concurrent_positions")
    .notNull()
    .default("3"),
  maxTotalDeployedSol: numeric("max_total_deployed_sol")
    .notNull()
    .default("0.15"),
  /* PR04 chain-neutral successors — same additive rationale as trades
   * above. The *Sol columns stay authoritative/NOT NULL; risk thresholds
   * and semantics are unchanged by this PR. */
  maxNativePerSnipe: numeric("max_native_per_snipe"),
  maxNativeDeployed: numeric("max_native_deployed"),
  nativeSymbol: text("native_symbol"),

  // Exit strategy (scripts/sniper-daemon.ts#checkExits)
  exitMode: text("exit_mode").notNull().default("fixed"), // fixed | tiered
  takeProfitPct: numeric("take_profit_pct").notNull().default("50"),
  stopLossPct: numeric("stop_loss_pct").notNull().default("20"),
  takeProfitTiers: jsonb("take_profit_tiers")
    .$type<{ atPct: number; sellPortionPct: number }[]>()
    .notNull()
    .default([]), // only read when exitMode = "tiered"
  trailingStopEnabled: boolean("trailing_stop_enabled")
    .notNull()
    .default(false),
  trailingStopActivationPct: numeric("trailing_stop_activation_pct")
    .notNull()
    .default("30"),
  trailingStopPct: numeric("trailing_stop_pct").notNull().default("15"),
  breakevenAfterPct: numeric("breakeven_after_pct"), // null = disabled
  maxHoldTimeSec: numeric("max_hold_time_sec"), // null = no cap
  crashDropPct: numeric("crash_drop_pct").notNull().default("15"),
  exitCheckIntervalMs: numeric("exit_check_interval_ms")
    .notNull()
    .default("4000"),

  // Circuit breaker (lib/sniper/risk-limits.ts)
  maxConsecutiveLosses: numeric("max_consecutive_losses")
    .notNull()
    .default("3"),
  maxDailyDrawdownSol: numeric("max_daily_drawdown_sol")
    .notNull()
    .default("0.1"),
  maxDailyDrawdownNative: numeric("max_daily_drawdown_native"),
  cooldownAfterLossSec: numeric("cooldown_after_loss_sec")
    .notNull()
    .default("0"),

  metadataFetchTimeoutMs: numeric("metadata_fetch_timeout_ms")
    .notNull()
    .default("3000"),

  /* PR06.5 — Robinhood/EVM-specific safety policy. Additive: the legacy
   * Solana fields above (requireMintAuthorityRenounced,
   * requireFreezeAuthorityRenounced, maxCreatorBuyPct, minLiquiditySol)
   * are untouched and remain Solana-only. These are deliberate new EVM
   * policy choices, not semantic translations of the Solana fields — see
   * lib/gmgn/safety-robinhood.ts for why mint/freeze-authority concepts
   * don't carry over. */
  requireOwnerRenounced: boolean("require_owner_renounced")
    .notNull()
    .default(true),
  requireNoBlacklistCapability: boolean("require_no_blacklist_capability")
    .notNull()
    .default(true),
  /* Robinhood equivalent of maxCreatorBuyPct — but measures CURRENT
   * creator holding concentration (creatorHoldRate), not initial
   * buy/allocation, which cannot be reliably reconstructed on Robinhood
   * (see safety-robinhood.ts). Still nullable (null continues to mean
   * "not yet configured" → configuration blocker) but now defaults to
   * the approved v1 value (10) for new rows — see
   * drizzle/0003_robinhood_v1_policy.sql for the matching backfill of
   * existing NULL rows. Never silently inherits maxCreatorBuyPct's
   * threshold just because both are percentages. */
  maxCreatorHoldPct: numeric("max_creator_hold_pct").default("10"),
});

/**
 * Audit trail for every sniper_config change, whether made by hand from
 * the dashboard or applied from a lesson's suggestedConfig.
 */
export const sniperConfigHistory = pgTable("sniper_config_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  source: text("source").notNull(), // user | lesson
  lessonId: uuid("lesson_id").references(() => lessons.id),
  before: jsonb("before").notNull(),
  after: jsonb("after").notNull(),
});

export type SniperState = typeof sniperState.$inferSelect;
export type SniperConfigRow = typeof sniperConfig.$inferSelect;
export type SniperConfigHistory = typeof sniperConfigHistory.$inferSelect;
