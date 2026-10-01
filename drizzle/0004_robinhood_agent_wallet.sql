-- PR09: additive, chain-neutral agent-wallet metadata for user_bots.
--
-- Every ALTER TABLE below is ADD COLUMN (nullable, no rename/drop of any
-- existing column) and is safe to re-run on its own (IF NOT EXISTS),
-- same convention as drizzle/0001_chain_neutral_foundation.sql.
--
-- This is exactly the "agentPublicKey/agentSecretEnc/rpcUrl ... deferred
-- to the EVM agent-wallet phase" item PR04's report flagged as
-- out-of-scope for that pass - this is that phase.

-- ── user_bots ───────────────────────────────────────────────────────────
ALTER TABLE "user_bots" ADD COLUMN IF NOT EXISTS "agent_chain" text;
ALTER TABLE "user_bots" ADD COLUMN IF NOT EXISTS "agent_network" text;
ALTER TABLE "user_bots" ADD COLUMN IF NOT EXISTS "agent_native_symbol" text;

-- ── one-time historical Solana backfill ────────────────────────────────
-- Runs exactly once, gated on the "_migrations" marker (created by
-- 0001_chain_neutral_foundation.sql), not on column nullness. Every
-- user_bots row that exists AT THE MOMENT THIS MIGRATION FIRST RUNS
-- predates PR09 - no EVM agent-signing path existed before it - and is
-- unambiguously Solana, regardless of whether that specific bot ever
-- had an agent wallet generated (agent_public_key may be NULL; the
-- chain label describes what chain this bot WOULD use, not whether a
-- wallet exists yet). "agent_network" is left NULL for this legacy
-- backfill - which network a historical Solana agent wallet ran on was
-- never recorded, and preservation means leaving that unknown rather
-- than guessing, same reasoning PR04 used for trades/positions/logs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_migrations" WHERE "name" = '0004_robinhood_agent_wallet') THEN

    UPDATE "user_bots"
    SET "agent_chain" = 'solana',
        "agent_native_symbol" = 'SOL'
    WHERE "agent_chain" IS NULL;

    INSERT INTO "_migrations" ("name") VALUES ('0004_robinhood_agent_wallet');

  END IF;
END $$;
