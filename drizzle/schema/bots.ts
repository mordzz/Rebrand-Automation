/** Deployed bots: owner wallet, autonomous agent wallet, Lighter credentials. */
import { sql } from "drizzle-orm";
import { bigint, boolean, check, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * One row per user-deployed automaton (app/deploy). Keyed by the Privy-
 * connected wallet address. `config` holds a partial SniperConfig that
 * overlays the house defaults (see app/api/my-bot/config). Paper-mode
 * only for now - scripts/paper-daemon.ts executes these; real (live)
 * execution doesn't exist yet.
 */
export const userBots = pgTable("user_bots", {
  id: uuid("id").defaultRandom().primaryKey(),
  /* At most one row may ever be true (enforced by the partial unique
   * index below) - the single public "Noah" agent shown on /dashboard,
   * with no login. Every /api/my-bot mutating route refuses to touch a
   * bot with this flag set (see lib/db/official-bot.ts#assertNotOfficial):
   * once a bot's wallet address is printed on a public page, the
   * client-asserted-wallet trust model the rest of this table relies on
   * no longer holds. A CHECK constraint below backs this up structurally
   * for tradingMode specifically, independent of any application code. */
  isOfficial: boolean("is_official").notNull().default(false),
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
   * act rather than an accident.
   *
   * PR16: historical only. This held a per-bot SOLANA RPC endpoint; the
   * Robinhood runtime uses the server's ROBINHOOD_RPC_URL, and the panel +
   * route that edited this column were retired. Never selected into a
   * browser response. */
  rpcUrl: text("rpc_url"),
  /* This agent's own trading wallet, generated at deploy.
   *
   * Separate from walletAddress above: that one is the operator's owner (EVM)
   * wallet, used only to identify who owns this bot, and its keys are
   * never requested or held. This one is a fresh keypair the agent signs
   * with, so it can trade without the operator present. Only what the
   * operator chooses to deposit here is ever at risk.
   *
   * The secret is stored AES-256-GCM encrypted under a key that lives in
   * the environment, never in this table - a database dump on its own
   * must not be enough to drain these wallets. See
   * lib/solana/agent-wallet.ts. No API ever returns this column. */
  agentPublicKey: text("agent_public_key"),
  agentSecretEnc: text("agent_secret_enc"),
  /* Chain/network metadata for the agent wallet above - added in PR09,
   * additive only (see drizzle/0004_robinhood_agent_wallet.sql). Every
   * bot deployed before PR09 is unambiguously Solana (no other signer
   * existed) and was backfilled accordingly; NULL network for those
   * legacy rows means "never recorded", never a guess. A NEW bot's agent
   * wallet is chain-aware from the moment it's generated: EVM-owned bots
   * (0x wallet_address) get "robinhood"/"testnet"/"ETH"; legacy-flow
   * Solana bots keep getting "solana"/null/"SOL". Runtime code must
   * dispatch on this column, never infer chain from address shape alone. */
  agentChain: text("agent_chain"),
  agentNetwork: text("agent_network"),
  agentNativeSymbol: text("agent_native_symbol"),
  /* PR12 Lighter perps credentials (drizzle/0005_lighter_api_credentials.sql).
   * The Lighter account is owned by the AGENT wallet above, never the owner
   * wallet. `lighterApiKeyEnc` is an encrypted blob only decryptable inside
   * the Lighter signer worker - never select it into a browser response. */
  lighterNetwork: text("lighter_network"),
  lighterAccountIndex: bigint("lighter_account_index", { mode: "number" }),
  lighterApiKeyIndex: integer("lighter_api_key_index"),
  lighterApiPublicKey: text("lighter_api_public_key"),
  lighterApiKeyEnc: text("lighter_api_key_enc"),
  lighterApiKeyStatus: text("lighter_api_key_status"),
  lighterApiKeyRegisteredAt: timestamp("lighter_api_key_registered_at", { withTimezone: true }),
  /* "paper" | "live". Defaults to paper and stays there until the operator
   * turns it on deliberately - Design Principle 3 in the whitepaper: every
   * agent begins in dry-run, and going live is a separate decision, not a
   * side effect of pressing Start. `active` says whether the bot trades at
   * all; this says whether those trades spend real money. */
  tradingMode: text("trading_mode").notNull().default("paper"),
  /* User-controlled master switch - independent of the circuit breaker
   * below. Deploying (naming + picking a character) only configures a
   * bot; it starts inactive until the operator explicitly starts it from
   * /deploy. Gates new position entries only in scripts/paper-daemon.ts -
   * an already-open position keeps being watched and exited by its own
   * rules even after the bot is stopped, same "pause new entries, never
   * abandon existing risk" posture the circuit breaker itself uses.
   * Once true, the standalone paper-daemon process (not this web server,
   * not the browser) is what keeps trading it - closing /deploy or the
   * whole browser has no effect on it. */
  active: boolean("active").notNull().default(false),
  /* The per-wallet circuit breaker (lib/sniper/risk-limits.ts#deriveTradingPause)
   * is re-derived fresh from this wallet's own trades on every check - there
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
