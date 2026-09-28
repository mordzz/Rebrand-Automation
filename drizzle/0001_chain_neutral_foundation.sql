-- PR04: additive, chain-neutral schema foundation.
--
-- Every statement below is either ADD COLUMN (nullable, no rename/drop of
-- any existing column) or an UPDATE that only ever fills a *new* column
-- for rows that predate this migration and are unambiguously Solana —
-- no existing column is modified, and no row is deleted. Safe to re-run
-- (IF NOT EXISTS / WHERE ... IS NULL throughout).
--
-- This repo has historically used `drizzle-kit push` (schema-diff, no
-- tracked migration files) rather than generated migrations — this file
-- is hand-authored, not drizzle-kit-generated, specifically so its SQL
-- can be reviewed before it touches the database (see PR04 report).

-- ── trades ──────────────────────────────────────────────────────────────
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "size_native" numeric;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "pnl_native" numeric;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "native_symbol" text;
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "chain" text;

UPDATE "trades"
SET "size_native" = "size_sol",
    "pnl_native" = "pnl_sol",
    "native_symbol" = 'SOL',
    "chain" = 'solana'
WHERE "chain" IS NULL;

-- ── positions ───────────────────────────────────────────────────────────
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "token_address" text;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "size_native" numeric;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "entry_tx_hash" text;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "native_symbol" text;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "chain" text;

UPDATE "positions"
SET "token_address" = "token",
    "size_native" = "size_sol",
    "entry_tx_hash" = "entry_tx_signature",
    "native_symbol" = 'SOL',
    "chain" = 'solana'
WHERE "chain" IS NULL;

-- ── logs ────────────────────────────────────────────────────────────────
ALTER TABLE "logs" ADD COLUMN IF NOT EXISTS "tx_hash" text;
ALTER TABLE "logs" ADD COLUMN IF NOT EXISTS "token_address" text;
ALTER TABLE "logs" ADD COLUMN IF NOT EXISTS "chain" text;

-- Every log row that predates this migration was written while this app
-- only ran on Solana, so "chain" is unambiguous even though tx_signature
-- is sometimes the literal "paper" sentinel for simulated trades.
UPDATE "logs"
SET "tx_hash" = "tx_signature",
    "token_address" = "token_mint",
    "chain" = 'solana'
WHERE "chain" IS NULL;

-- ── sniper_state ────────────────────────────────────────────────────────
ALTER TABLE "sniper_state" ADD COLUMN IF NOT EXISTS "daily_pnl_native" numeric;
ALTER TABLE "sniper_state" ADD COLUMN IF NOT EXISTS "native_symbol" text;

UPDATE "sniper_state"
SET "daily_pnl_native" = "daily_pnl_sol",
    "native_symbol" = 'SOL'
WHERE "native_symbol" IS NULL;

-- ── sniper_config ───────────────────────────────────────────────────────
ALTER TABLE "sniper_config" ADD COLUMN IF NOT EXISTS "max_native_per_snipe" numeric;
ALTER TABLE "sniper_config" ADD COLUMN IF NOT EXISTS "max_native_deployed" numeric;
ALTER TABLE "sniper_config" ADD COLUMN IF NOT EXISTS "max_daily_drawdown_native" numeric;
ALTER TABLE "sniper_config" ADD COLUMN IF NOT EXISTS "native_symbol" text;

UPDATE "sniper_config"
SET "max_native_per_snipe" = "max_sol_per_snipe",
    "max_native_deployed" = "max_total_deployed_sol",
    "max_daily_drawdown_native" = "max_daily_drawdown_sol",
    "native_symbol" = 'SOL'
WHERE "native_symbol" IS NULL;

-- ── alpha_candidates ────────────────────────────────────────────────────
ALTER TABLE "alpha_candidates" ADD COLUMN IF NOT EXISTS "token_address" text;
ALTER TABLE "alpha_candidates" ADD COLUMN IF NOT EXISTS "chain" text;

UPDATE "alpha_candidates"
SET "token_address" = "token",
    "chain" = 'solana'
WHERE "chain" IS NULL;

-- ── user_bots, perpspad_* ───────────────────────────────────────────────
-- Deliberately untouched in PR04 — see the PR04 report's audit notes for
-- user_bots (deferred to the wallet-ownership-signature migration) and
-- perpspad_* (deferred to PR11-13 pending Lighter capability verification).
