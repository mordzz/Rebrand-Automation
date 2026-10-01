/**
 * The complete database schema - the single source of truth.
 *
 * A new, empty database is initialized directly from this file with
 * `npm run db:push` (drizzle-kit push). There is no migration history:
 * every table below starts at its final Robinhood-first shape.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ── Bots ────────────────────────────────────────────────────────────────

/**
 * One row per user-deployed automaton (app/deploy). Keyed by the Privy-
 * connected owner wallet address. `config` holds a partial SniperConfig
 * that overlays the house defaults (see app/api/my-bot/config).
 */
export const userBots = pgTable("user_bots", {
  id: uuid("id").defaultRandom().primaryKey(),
  /* At most one row may ever be true (enforced by the partial unique
   * index below) - the single public "Noah" agent shown on /dashboard,
   * with no login. Every /api/my-bot mutating route refuses to touch a
   * bot with this flag set (see lib/db/official-bot.ts#assertNotOfficial).
   * A CHECK constraint below backs this up structurally for tradingMode
   * specifically, independent of any application code. */
  isOfficial: boolean("is_official").notNull().default(false),
  walletAddress: text("wallet_address").notNull().unique(),
  name: text("name").notNull(),
  characterType: text("character_type").notNull(), // 3d | image | gif
  characterSrc: text("character_src"), // null for 3d (built-in canvas)
  config: jsonb("config").notNull().default({}),
  /* This agent's own EVM trading wallet, generated at deploy.
   *
   * Separate from walletAddress above: that one is the operator's owner
   * wallet, used only to identify who owns this bot, and its keys are
   * never requested or held. This one is a fresh key the agent signs
   * with, so it can trade without the operator present.
   *
   * The secret is stored AES-256-GCM encrypted under
   * AGENT_WALLET_ENCRYPTION_KEY, which lives in the environment, never in
   * this table - a database dump on its own must not be enough to drain
   * these wallets. No API ever returns agentSecretEnc. */
  agentPublicKey: text("agent_public_key"),
  agentSecretEnc: text("agent_secret_enc"),
  /* Chain/network of the agent wallet above ("robinhood"/"testnet"/"ETH").
   * Runtime code dispatches on these, never on address shape alone. */
  agentChain: text("agent_chain"),
  agentNetwork: text("agent_network"),
  agentNativeSymbol: text("agent_native_symbol"),
  /* Lighter perps credentials. The Lighter account is owned by the AGENT
   * wallet above, never the owner wallet. `lighterApiKeyEnc` is ciphertext
   * under LIGHTER_API_KEY_ENCRYPTION_KEY (a separate key from the agent
   * wallet's) and is only ever decrypted server-side to sign a Lighter
   * request - never select it into a browser response. */
  lighterNetwork: text("lighter_network"),
  lighterAccountIndex: bigint("lighter_account_index", { mode: "number" }),
  lighterApiKeyIndex: integer("lighter_api_key_index"),
  lighterApiPublicKey: text("lighter_api_public_key"),
  lighterApiKeyEnc: text("lighter_api_key_enc"),
  lighterApiKeyStatus: text("lighter_api_key_status"),
  lighterApiKeyRegisteredAt: timestamp("lighter_api_key_registered_at", { withTimezone: true }),
  /* "paper" | "live". Defaults to paper and stays there until the operator
   * turns it on deliberately - every agent begins in dry-run, and going
   * live is a separate decision, not a side effect of pressing Start.
   * `active` says whether the bot trades at all; this says whether those
   * trades spend real money. */
  tradingMode: text("trading_mode").notNull().default("paper"),
  /* Running / Stopped - the operator's master switch, independent of the
   * circuit breaker below. A bot starts stopped until the operator starts
   * it from /deploy. Gates new position entries in scripts/paper-daemon.ts;
   * an already-open position keeps being watched and exited by its own
   * rules even after the bot is stopped. */
  active: boolean("active").notNull().default(false),
  /* The per-wallet circuit breaker
   * (lib/sniper/risk-limits-robinhood.ts#deriveRobinhoodTradingPause) is
   * re-derived fresh from this wallet's own trades on every check - there
   * is no persisted pause flag. When this timestamp is set, pause
   * derivation only looks at trades closed after it, so a manual reset
   * (POST /api/my-bot/reset-breaker) unsticks the bot immediately without
   * touching trade history. */
  breakerResetAt: timestamp("breaker_reset_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("user_bots_official_unique_idx")
    .on(table.isOfficial)
    .where(sql`is_official = true`),
  /* Belt-and-suspenders alongside the application-level guard: even a
   * future bug or a forgotten check can never flip the public bot to
   * live trading, because Postgres itself refuses the row. */
  check(
    "user_bots_official_never_live",
    sql`NOT (is_official AND trading_mode = 'live')`
  ),
]);

export type UserBot = typeof userBots.$inferSelect;

// ── Trading ─────────────────────────────────────────────────────────────

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /* null = the house desk (dashboard); set = one deployed bot's own
       ledger (deploy). */
    walletAddress: text("wallet_address"),
    token: text("token").notNull(), // display symbol
    strategy: text("strategy").notNull(),
    entryPrice: numeric("entry_price"),
    exitPrice: numeric("exit_price"),
    /* Size and realized PnL in the chain's native unit (`nativeSymbol`). */
    sizeNative: numeric("size_native"),
    pnlNative: numeric("pnl_native").notNull(),
    nativeSymbol: text("native_symbol"),
    chain: text("chain"), // "robinhood"
    /* "testnet" | "mainnet" - Robinhood testnet (chain id 46630) vs
     * mainnet (4663); `chain` alone can't tell them apart. */
    network: text("network"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /* Anything the strategy engine knew at close time: hold duration,
       slippage, liquidity, stop distance, token address, etc. */
    context: jsonb("context"),
  },
  (table) => [
    // Backs the per-wallet circuit-breaker derivation (recent outcomes,
    // rolling daily PnL, last-loss lookup) in
    // lib/sniper/wallet-trade-stats-robinhood.ts.
    index("trades_wallet_closed_idx").on(table.walletAddress, table.closedAt),
  ]
);

/**
 * An open (or just-attempted) position. Graduates into a `trades` row via
 * closePosition() on exit - this table only tracks the "not settled yet"
 * lifecycle; trades is the ledger of closed results.
 */
export const positions = pgTable("positions", {
  id: uuid("id").defaultRandom().primaryKey(),
  /* Same null-means-house-desk convention as trades.walletAddress. */
  walletAddress: text("wallet_address"),
  tokenAddress: text("token_address").notNull(),
  symbol: text("symbol"),
  strategy: text("strategy").notNull().default("The Raven"),
  status: text("status").notNull().default("open"), // open | closed | failed
  entryPrice: numeric("entry_price").notNull(),
  sizeNative: numeric("size_native").notNull(),
  tokensBought: numeric("tokens_bought"),
  takeProfitPct: numeric("take_profit_pct").notNull(),
  stopLossPct: numeric("stop_loss_pct").notNull(),
  /* null for a paper position - a simulated entry has no transaction. */
  entryTxHash: text("entry_tx_hash"),
  nativeSymbol: text("native_symbol"),
  chain: text("chain"), // "robinhood"
  network: text("network"), // "testnet" | "mainnet" - see trades.network
  openedAt: timestamp("opened_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastPrice: numeric("last_price"),
  /* Highest price seen since the trailing stop activated (null until
     activation) - see lib/sniper/exit-logic.ts#evaluateFullExit. */
  peakPrice: numeric("peak_price"),
  /* Safety-check results, dry-run flag, triggeredTiers (indices into
     sniperConfig.takeProfitTiers already sold), etc. */
  context: jsonb("context"),
});

/**
 * Real execution events (curated, not a firehose - see lib/logs.ts) for the
 * dashboard's live execution terminal.
 */
export const logs = pgTable(
  "logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /* Same null-means-house-desk convention as trades/positions. */
    walletAddress: text("wallet_address"),
    level: text("level").notNull(), // info | buy | sell | guard | warn | error
    source: text("source").notNull().default("sniper"),
    message: text("message").notNull(),
    /* null for paper events - only a real broadcast has a hash. */
    txHash: text("tx_hash"),
    /* Token the line is about, so the console can link to something real. */
    tokenAddress: text("token_address"),
    chain: text("chain"), // "robinhood"
    network: text("network"), // "testnet" | "mainnet" - see trades.network
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("logs_wallet_created_idx").on(table.walletAddress, table.createdAt)]
);

export type Trade = typeof trades.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type LogEntry = typeof logs.$inferSelect;

// ── Learning ────────────────────────────────────────────────────────────

export const lessons = pgTable("lessons", {
  id: uuid("id").defaultRandom().primaryKey(),
  tradeId: uuid("trade_id").references(() => trades.id, {
    onDelete: "cascade",
  }),
  cause: text("cause").notNull(),
  lesson: text("lesson").notNull(),
  status: text("status").notNull().default("learning"), // learning | applied
  model: text("model").notNull().default("claude-opus-4-8"),
  /* A partial SniperConfig diff proposed alongside the lesson text - null
     when no concrete config change applies. Applied via
     POST /api/lessons/:id/apply, which sets status to "applied". */
  suggestedConfig: jsonb("suggested_config"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row per real model call (from ElizaOS's MODEL_USED event) or per
 * real chat turn (modelType: "chat_turn", written directly by
 * app/api/chat/route.ts to carry an accurate round-trip latency). Backs the
 * "Model connections" panel.
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

export type Lesson = typeof lessons.$inferSelect;
export type ModelRequest = typeof modelRequests.$inferSelect;

// ── Sniper configuration ────────────────────────────────────────────────

/**
 * Single-row, hot-reloadable house trading configuration. Every deployed
 * bot's effective config is this row with that bot's own `config` overlay
 * applied (lib/sniper/effective-config.ts). The daemon re-reads it every
 * roster refresh, so a change takes effect without a restart.
 *
 * The column defaults below are the product defaults: the row is created
 * from them on first read (lib/sniper/config.ts#getSniperConfig), and
 * lib/sniper/config.ts#DEFAULT_TRADING_CONFIG mirrors them for the no-DB
 * path (asserted equal by scripts/test-robinhood-safety.ts).
 */
export const sniperConfig = pgTable("sniper_config", {
  id: uuid("id").defaultRandom().primaryKey(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  // Entry filters
  requireSocialLink: boolean("require_social_link").notNull().default(true),
  /* Requires a confirmed buy from one of `alphaWallets` before entering. A
     no-op while alphaWallets is empty. */
  requireAlphaWalletBuy: boolean("require_alpha_wallet_buy")
    .notNull()
    .default(false),
  alphaWallets: jsonb("alpha_wallets").$type<string[]>().notNull().default([]),
  minTokenAgeSec: numeric("min_token_age_sec").notNull().default("0"),
  maxTokenAgeSec: numeric("max_token_age_sec"), // null = no ceiling
  blockedKeywords: jsonb("blocked_keywords")
    .$type<string[]>()
    .notNull()
    .default([]),

  // Robinhood/EVM safety policy (lib/gmgn/safety-robinhood.ts)
  requireOwnerRenounced: boolean("require_owner_renounced")
    .notNull()
    .default(true),
  requireNoBlacklistCapability: boolean("require_no_blacklist_capability")
    .notNull()
    .default(true),
  /* Ceiling on the creator's CURRENT holding concentration
   * (creatorHoldRate). null means "not configured" and the Robinhood
   * evaluator refuses with an explicit configuration blocker. */
  maxCreatorHoldPct: numeric("max_creator_hold_pct").default("10"),

  // Sizing and risk (lib/sniper/risk-limits-robinhood.ts). The native
  // limits deliberately have no default: until an operator sets all three
  // plus nativeSymbol = "ETH", Robinhood entries fail closed.
  maxConcurrentPositions: numeric("max_concurrent_positions")
    .notNull()
    .default("3"),
  maxNativePerSnipe: numeric("max_native_per_snipe"),
  maxNativeDeployed: numeric("max_native_deployed"),
  maxDailyDrawdownNative: numeric("max_daily_drawdown_native"),
  nativeSymbol: text("native_symbol"),

  // Exit strategy (lib/sniper/exit-logic.ts)
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

  // Circuit breaker
  /* Deliberately loose. This strategy targets a low win rate with an
     asymmetric payoff, so losing runs are its normal state rather than a
     fault signal; capital harm is bounded by maxDailyDrawdownNative. This
     counter exists only to catch a pathological run. */
  maxConsecutiveLosses: numeric("max_consecutive_losses")
    .notNull()
    .default("8"),
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

export type SniperConfigRow = typeof sniperConfig.$inferSelect;
export type SniperConfigHistory = typeof sniperConfigHistory.$inferSelect;

// ── Perpspad (paused product) ───────────────────────────────────────────

/**
 * One row per Perpspad token (app/perps). The product is paused; these
 * tables back its read-only pages. `programTokenPda` and
 * `driftSubaccountAuthority` are null while `status = "pending"`.
 */
export const perpspadTokens = pgTable(
  "perpspad_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /* Null while status = "pending". Nullable + unique: Postgres allows
       many NULLs under a unique index, so pending rows never collide. */
    mint: text("mint").unique(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    underlyingMarketIndex: numeric("underlying_market_index").notNull(),
    direction: text("direction").notNull(), // LONG | SHORT
    targetLeverage: numeric("target_leverage").notNull(),
    creatorWallet: text("creator_wallet").notNull(),
    programTokenPda: text("program_token_pda").unique(),
    driftSubaccountAuthority: text("drift_subaccount_authority"),
    meteoraPoolAddress: text("meteora_pool_address"),
    // pending | active | low_health | liquidated | accumulating
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
 * one token. `status` records a half-succeeded cycle honestly rather than
 * treating it as atomic.
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
 * Single-row Perpspad config. Basis points; the CHECK below is the DB half
 * of the fee-split invariant (app half:
 * lib/perps/fee-split.ts#assertValidFeeSplit).
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
