/** Trade ledger, open positions and the execution log. */
import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
    /* Chain-neutral successors to sizeSol/pnlSol (PR04 schema foundation —
     * see MIGRATION_MATRIX.md). Nullable and unbackfilled-by-default on
     * purpose: a column default would silently mislabel a future
     * Robinhood row that forgot to set it. Existing (pre-migration) rows
     * are explicitly backfilled once, since every row created before this
     * PR is unambiguously Solana — see drizzle/0001_chain_neutral_foundation.sql.
     * sizeSol/pnlSol stay in place; nothing reads/writes these new columns
     * yet. */
    sizeNative: numeric("size_native"),
    pnlNative: numeric("pnl_native"),
    nativeSymbol: text("native_symbol"),
    chain: text("chain"), // "solana" | "robinhood" | null (not yet backfilled)
    /* "testnet" | "mainnet" | null. Distinguishes Robinhood testnet
     * (chain id 46630) from mainnet (4663) — `chain` alone can't. Left
     * NULL for legacy Solana rows; never guessed. */
    network: text("network"),
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

/**
 * An open (or just-attempted) Sniper position. Graduates into a `trades`
 * row via recordClosedTrade() on exit — this table only tracks the "not
 * settled yet" lifecycle; trades is still the ledger of closed results.
 */
export const positions = pgTable("positions", {
  id: uuid("id").defaultRandom().primaryKey(),
  /* Same null-means-house-desk convention as trades.walletAddress. */
  walletAddress: text("wallet_address"),
  token: text("token").notNull(), // mint address (Solana) — see tokenAddress below
  symbol: text("symbol"),
  strategy: text("strategy").notNull().default("The Raven"),
  status: text("status").notNull().default("open"), // open | closed | failed
  entryPrice: numeric("entry_price").notNull(),
  sizeSol: numeric("size_sol").notNull(),
  tokensBought: numeric("tokens_bought"),
  takeProfitPct: numeric("take_profit_pct").notNull(),
  stopLossPct: numeric("stop_loss_pct").notNull(),
  entryTxSignature: text("entry_tx_signature").notNull(),
  /* Chain-neutral successors — same PR04 rationale as trades above.
   * `token`/`sizeSol`/`entryTxSignature` stay in place and NOT NULL;
   * these are additive and nullable until a later PR moves reads/writes
   * over. */
  tokenAddress: text("token_address"),
  sizeNative: numeric("size_native"),
  entryTxHash: text("entry_tx_hash"),
  nativeSymbol: text("native_symbol"),
  chain: text("chain"), // "solana" | "robinhood" | null (not yet backfilled)
  network: text("network"), // "testnet" | "mainnet" | null — see trades.network
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
    /* PR04 chain-neutral successors — txSignature/tokenMint stay in
     * place (including the literal "paper" sentinel for simulated
     * trades). See trades.sizeNative above for the additive rationale. */
    txHash: text("tx_hash"),
    tokenAddress: text("token_address"),
    chain: text("chain"), // "solana" | "robinhood" | null (not yet backfilled)
    network: text("network"), // "testnet" | "mainnet" | null — see trades.network
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("logs_wallet_created_idx").on(table.walletAddress, table.createdAt)]
);

export type Trade = typeof trades.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type LogEntry = typeof logs.$inferSelect;
