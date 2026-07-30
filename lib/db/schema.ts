import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const trades = pgTable(
  "trades",
  {
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
  },
  (table) => [
    // Backs the per-wallet circuit-breaker derivation (recent outcomes,
    // rolling daily P&L, last-loss lookup) in lib/sniper/wallet-trade-stats.ts
    // — a repeated per-wallet, time-windowed query pattern nothing indexed
    // before per-user paper trading existed.
    index("trades_wallet_closed_idx").on(table.walletAddress, table.closedAt),
  ]
);

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
export const logs = pgTable(
  "logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /* Same null-means-house-desk convention as trades/positions. Without
       this the dashboard's terminal — which reads the last N rows
       unfiltered — would show every deployed bot's activity mixed into
       the house's own feed, which is why the paper daemon wrote nothing
       here at all before the column existed. */
    walletAddress: text("wallet_address"),
    level: text("level").notNull(), // info | buy | sell | guard | warn | error
    source: text("source").notNull().default("sniper"),
    message: text("message").notNull(),
    txSignature: text("tx_signature"),
    /* Mint the line is about, so the console can link to something real.
       Paper trades have no transaction to point at — they write the
       literal "paper" as their signature — but the token itself is a real
       on-chain account, and that is what an operator actually wants to
       open when reading back what their bot did. */
    tokenMint: text("token_mint"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("logs_wallet_created_idx").on(table.walletAddress, table.createdAt)]
);

/**
 * One row per user-deployed automaton (app/deploy). Keyed by the Privy-
 * connected wallet address. `config` holds a partial SniperConfig that
 * overlays the house defaults (see app/api/my-bot/config). Paper-mode
 * only for now — scripts/paper-daemon.ts executes these; real (live)
 * execution doesn't exist yet.
 */
export const userBots = pgTable("user_bots", {
  id: uuid("id").defaultRandom().primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  name: text("name").notNull(),
  characterType: text("character_type").notNull(), // 3d | image | gif
  characterSrc: text("character_src"), // null for 3d (built-in canvas)
  config: jsonb("config").notNull().default({}),
  /* Optional private Solana RPC for this bot's own on-chain reads.
   *
   * Deliberately its own column rather than a key inside `config`:
   * GET /api/my-bot/config returns the whole effective config to the
   * browser, and provider URLs normally carry the API key in them
   * (`?api-key=…`). Sitting in that blob it would be handed to anyone who
   * knows a wallet address, since that endpoint trusts a client-asserted
   * wallet. Keeping it separate means leaking it has to be a deliberate
   * act rather than an accident — app/api/my-bot/rpc only ever returns a
   * masked form, and nothing else selects this column. */
  rpcUrl: text("rpc_url"),
  /* This agent's own trading wallet, generated at deploy.
   *
   * Separate from walletAddress above: that one is the operator's Phantom
   * wallet, used only to identify who owns this bot, and its keys are
   * never requested or held. This one is a fresh keypair the agent signs
   * with, so it can trade without the operator present. Only what the
   * operator chooses to deposit here is ever at risk.
   *
   * The secret is stored AES-256-GCM encrypted under a key that lives in
   * the environment, never in this table — a database dump on its own
   * must not be enough to drain these wallets. See
   * lib/solana/agent-wallet.ts. No API ever returns this column. */
  agentPublicKey: text("agent_public_key"),
  agentSecretEnc: text("agent_secret_enc"),
  /* "paper" | "live". Defaults to paper and stays there until the operator
   * turns it on deliberately — Design Principle 3 in the whitepaper: every
   * agent begins in dry-run, and going live is a separate decision, not a
   * side effect of pressing Start. `active` says whether the bot trades at
   * all; this says whether those trades spend real money. */
  tradingMode: text("trading_mode").notNull().default("paper"),
  /* User-controlled master switch — independent of the circuit breaker
   * below. Deploying (naming + picking a character) only configures a
   * bot; it starts inactive until the operator explicitly starts it from
   * /deploy. Gates new position entries only in scripts/paper-daemon.ts —
   * an already-open position keeps being watched and exited by its own
   * rules even after the bot is stopped, same "pause new entries, never
   * abandon existing risk" posture the circuit breaker itself uses.
   * Once true, the standalone paper-daemon process (not this web server,
   * not the browser) is what keeps trading it — closing /deploy or the
   * whole browser has no effect on it. */
  active: boolean("active").notNull().default(false),
  /* The per-wallet circuit breaker (lib/sniper/risk-limits.ts#deriveTradingPause)
   * is re-derived fresh from this wallet's own trades on every check — there
   * is no persisted `tradingPaused` flag to flip, unlike the house's
   * sniper_state singleton. That's deliberate (self-healing, no admin
   * surface needed) but it also means a bot whose very first trades are
   * losses can trip the limit and then never trade again to earn the win
   * that would clear it. This timestamp is the escape hatch: when set,
   * pause derivation only looks at trades closed after it, so a manual
   * reset (POST /api/my-bot/reset-breaker) unsticks the bot immediately
   * without touching trade history or requiring a persisted pause flag. */
  breakerResetAt: timestamp("breaker_reset_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * UNUSED — nothing reads or writes this table any more.
 *
 * It held the /atelier chat as one shared, durable thread per agent. That
 * was the wrong shape: /atelier has no visitor login, so a single thread
 * meant every visitor read and appended to the same transcript, each
 * person seeing the last person's questions. The chat is now ephemeral
 * per browser tab (app/api/atelier/chat is stateless; the modal holds the
 * conversation in component state and discards it on close).
 *
 * What an agent actually remembers is unaffected and lives elsewhere: its
 * post-mortems in `lessons` and its record in `trades`/`positions`. That
 * is what grounds its replies and gives it an identity.
 *
 * Kept, not dropped, so existing rows aren't destroyed by a schema push.
 * Safe to remove along with its rows once you no longer want them.
 */
export const agentChatMessages = pgTable(
  "agent_chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => userBots.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_chat_messages_bot_created_idx").on(table.botId, table.createdAt),
  ]
);

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

export type Trade = typeof trades.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type SniperState = typeof sniperState.$inferSelect;
export type SniperConfigRow = typeof sniperConfig.$inferSelect;
export type SniperConfigHistory = typeof sniperConfigHistory.$inferSelect;
export type ModelRequest = typeof modelRequests.$inferSelect;
export type LogEntry = typeof logs.$inferSelect;
export type UserBot = typeof userBots.$inferSelect;
export type AlphaCandidate = typeof alphaCandidates.$inferSelect;
export type AgentChatMessageRow = typeof agentChatMessages.$inferSelect;
