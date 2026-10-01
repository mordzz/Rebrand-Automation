-- PR04: additive, chain-neutral schema foundation.
--
-- Every ALTER TABLE below is ADD COLUMN (nullable, no rename/drop of any
-- existing column) and is safe to re-run on its own (IF NOT EXISTS).
--
-- The historical Solana backfill is a ONE-TIME operation, gated on the
-- "_migrations" marker table below - not on "WHERE chain IS NULL". A
-- future Robinhood row that ends up with a NULL chain/network discriminator
-- (a partial or buggy write) must stay NULL on re-run, not get silently
-- relabeled "solana" just because it's null. The marker is what actually
-- proves "this row predates the migration", not the column's nullness.
--
-- This repo has historically used `drizzle-kit push` (schema-diff, no
-- tracked migration files) rather than generated migrations - this file
-- is hand-authored, not drizzle-kit-generated, specifically so its SQL
-- can be reviewed before it touches the database (see PR04 report).

CREATE TABLE IF NOT EXISTS "_migrations" (
  "name" text PRIMARY KEY,
  "applied_at" timestamptz NOT NULL DEFAULT now()
);

-- ── trades ──────────────────────────────────────────────────────────────
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "size_native" numeric;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "pnl_native" numeric;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "native_symbol" text;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "chain" text;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "network" text;

-- ── positions ───────────────────────────────────────────────────────────
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "token_address" text;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "size_native" numeric;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "entry_tx_hash" text;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "native_symbol" text;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "chain" text;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "network" text;

-- ── logs ────────────────────────────────────────────────────────────────
ALTER TABLE "logs" ADD COLUMN IF NOT EXISTS "tx_hash" text;
ALTER TABLE "logs" ADD COLUMN IF NOT EXISTS "token_address" text;
ALTER TABLE "logs" ADD COLUMN IF NOT EXISTS "chain" text;
ALTER TABLE "logs" ADD COLUMN IF NOT EXISTS "network" text;

-- ── sniper_state ────────────────────────────────────────────────────────
ALTER TABLE "sniper_state" ADD COLUMN IF NOT EXISTS "daily_pnl_native" numeric;
ALTER TABLE "sniper_state" ADD COLUMN IF NOT EXISTS "native_symbol" text;

-- ── sniper_config ───────────────────────────────────────────────────────
ALTER TABLE "sniper_config" ADD COLUMN IF NOT EXISTS "max_native_per_snipe" numeric;
ALTER TABLE "sniper_config" ADD COLUMN IF NOT EXISTS "max_native_deployed" numeric;
ALTER TABLE "sniper_config" ADD COLUMN IF NOT EXISTS "max_daily_drawdown_native" numeric;
ALTER TABLE "sniper_config" ADD COLUMN IF NOT EXISTS "native_symbol" text;

-- ── alpha_candidates ────────────────────────────────────────────────────
ALTER TABLE "alpha_candidates" ADD COLUMN IF NOT EXISTS "token_address" text;
ALTER TABLE "alpha_candidates" ADD COLUMN IF NOT EXISTS "chain" text;
ALTER TABLE "alpha_candidates" ADD COLUMN IF NOT EXISTS "network" text;

-- ── user_bots, perpspad_* ───────────────────────────────────────────────
-- Deliberately untouched in PR04 - see the PR04 report's audit notes:
-- user_bots.walletAddress (operator identity) is deferred to the wallet-
-- ownership-signature migration; agentPublicKey/agentSecretEnc/rpcUrl are
-- deferred to the EVM agent-wallet phase; perpspad_* is deferred to
-- PR11-13 pending Lighter capability verification.

-- ── one-time historical Solana backfill ────────────────────────────────
-- Runs exactly once, gated on the "_migrations" marker, not on column
-- nullness. Every row that exists in this database AT THE MOMENT THIS
-- MIGRATION FIRST RUNS predates the Robinhood migration and is
-- unambiguously Solana; anything inserted after this point is not
-- touched by this block on a later run, regardless of what its
-- discriminator columns contain. "network" is left NULL for this legacy
-- backfill - which network a historical Solana trade ran on was never
-- recorded, and preservation means leaving that unknown rather than
-- guessing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_migrations" WHERE "name" = '0001_chain_neutral_foundation') THEN

    UPDATE "trades"
    SET "size_native" = "size_sol",
        "pnl_native" = "pnl_sol",
        "native_symbol" = 'SOL',
        "chain" = 'solana';

    UPDATE "positions"
    SET "token_address" = "token",
        "size_native" = "size_sol",
        "entry_tx_hash" = "entry_tx_signature",
        "native_symbol" = 'SOL',
        "chain" = 'solana';

    -- tx_hash represents an actual on-chain transaction identifier, not
    -- an execution-mode sentinel: paper trades' literal 'paper' signature
    -- stays in tx_signature untouched, but does NOT get copied into
    -- tx_hash - that column stays NULL for those rows.
    UPDATE "logs"
    SET "tx_hash" = CASE WHEN "tx_signature" = 'paper' THEN NULL ELSE "tx_signature" END,
        "token_address" = "token_mint",
        "chain" = 'solana';

    UPDATE "sniper_state"
    SET "daily_pnl_native" = "daily_pnl_sol",
        "native_symbol" = 'SOL';

    UPDATE "sniper_config"
    SET "max_native_per_snipe" = "max_sol_per_snipe",
        "max_native_deployed" = "max_total_deployed_sol",
        "max_daily_drawdown_native" = "max_daily_drawdown_sol",
        "native_symbol" = 'SOL';

    UPDATE "alpha_candidates"
    SET "token_address" = "token",
        "chain" = 'solana';

    INSERT INTO "_migrations" ("name") VALUES ('0001_chain_neutral_foundation');

  END IF;
END $$;
