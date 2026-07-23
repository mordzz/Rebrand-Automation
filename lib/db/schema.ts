import {
  boolean,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const trades = pgTable("trades", {
  id: uuid("id").defaultRandom().primaryKey(),
  /* null = the house desk (dashboard); set = one deployed bot's own
     ledger (deploy). Keeps each connected wallet's numbers separate
     from the shared house desk instead of showing the same data. */
  walletAddress: text("wallet_address"),
  token: text("token").notNull(),
  strategy: text("strategy").notNull(),
  entryPrice: numeric("entry_price"),
  exitPrice: numeric("exit_price"),
  sizeSol: numeric("size_sol"),
  pnlSol: numeric("pnl_sol").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /* Anything the strategy engine knew at close time: hold duration,
     slippage, liquidity, stop distance, leader wallet, etc. */
  context: jsonb("context"),
});

export const lessons = pgTable("lessons", {
  id: uuid("id").defaultRandom().primaryKey(),
  tradeId: uuid("trade_id").references(() => trades.id, {
    onDelete: "cascade",
  }),
  cause: text("cause").notNull(),
  lesson: text("lesson").notNull(),
  status: text("status").notNull().default("learning"), // learning | applied
  model: text("model").notNull().default("claude-opus-4-8"),
  /* A partial SniperConfig diff Claude proposes alongside the lesson text —
     null when no concrete config change applies. Applied via
     POST /api/lessons/:id/apply, which sets status to "applied". */
  suggestedConfig: jsonb("suggested_config"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * An open (or just-attempted) Sniper position. Graduates into a `trades`
 * row via recordClosedTrade() on exit — this table only tracks the "not
 * settled yet" lifecycle; trades is still the ledger of closed results.
 */
export const positions = pgTable("positions", {
  id: uuid("id").defaultRandom().primaryKey(),
  /* Same null-means-house-desk convention as trades.walletAddress. */
  walletAddress: text("wallet_address"),
  token: text("token").notNull(), // mint address
  symbol: text("symbol"),
  strategy: text("strategy").notNull().default("The Raven"),
  status: text("status").notNull().default("open"), // open | closed | failed
  entryPrice: numeric("entry_price").notNull(),
  sizeSol: numeric("size_sol").notNull(),
  tokensBought: numeric("tokens_bought"),
  takeProfitPct: numeric("take_profit_pct").notNull(),
  stopLossPct: numeric("stop_loss_pct").notNull(),
  entryTxSignature: text("entry_tx_signature").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastPrice: numeric("last_price"),
  /* Highest price seen since the trailing stop activated (null until
     activation) — see checkExits in scripts/sniper-daemon.ts. */
  peakPrice: numeric("peak_price"),
  /* Safety-check results, dry-run flag, liquidity at entry, triggeredTiers
     (indices into sniperConfig.takeProfitTiers already sold), etc. */
  context: jsonb("context"),
});

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
  cooldownAfterLossSec: numeric("cooldown_after_loss_sec")
    .notNull()
    .default("0"),

  metadataFetchTimeoutMs: numeric("metadata_fetch_timeout_ms")
    .notNull()
    .default("3000"),
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

/**
 * One row per real model call (from ElizaOS's MODEL_USED event) or per
 * real chat turn (modelType: "chat_turn", written directly by
 * app/api/chat/route.ts to carry an accurate round-trip latency — the
 * event payload itself doesn't include timing). Backs the "Model
 * connections" panel's real requests-per-provider chart and latency stat.
 */
export const modelRequests = pgTable("model_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(), // openrouter | anthropic | openai
  modelType: text("model_type").notNull(), // e.g. TEXT_LARGE, TEXT_EMBEDDING, or "chat_turn"
  totalTokens: numeric("total_tokens"),
  latencyMs: numeric("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Real execution events (curated, not a firehose — see lib/logs.ts) for the
 * dashboard's live execution terminal. Currently only the sniper daemon
 * writes here.
 */
export const logs = pgTable("logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  level: text("level").notNull(), // info | buy | sell | guard | warn | error
  source: text("source").notNull().default("sniper"),
  message: text("message").notNull(),
  txSignature: text("tx_signature"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row per user-deployed automaton (app/deploy). Keyed by the Privy-
 * connected wallet address. `config` holds a partial SniperConfig that
 * overlays the house defaults (see app/api/my-bot/config). Paper-mode
 * only for now — no daemon executes these yet.
 */
export const userBots = pgTable("user_bots", {
  id: uuid("id").defaultRandom().primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  name: text("name").notNull(),
  characterType: text("character_type").notNull(), // 3d | image | gif
  characterSrc: text("character_src"), // null for 3d (built-in canvas)
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Trade = typeof trades.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type SniperState = typeof sniperState.$inferSelect;
export type SniperConfigRow = typeof sniperConfig.$inferSelect;
export type SniperConfigHistory = typeof sniperConfigHistory.$inferSelect;
export type ModelRequest = typeof modelRequests.$inferSelect;
export type LogEntry = typeof logs.$inferSelect;
export type UserBot = typeof userBots.$inferSelect;
