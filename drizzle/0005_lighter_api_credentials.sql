-- PR12: additive Lighter (Robinhood perps) credential metadata for user_bots.
--
-- ADD COLUMN only, nullable, safe to re-run (IF NOT EXISTS) - same
-- convention as 0001/0004. No backfill: no bot had a Lighter account before
-- PR12, so NULL means "not provisioned", never a guess. Historical Solana
-- rows are untouched.
--
-- The Lighter account is owned by the bot's autonomous agent wallet
-- (agent_public_key), never the owner's Privy wallet. Only an ENCRYPTED
-- Lighter API private key is stored (LIGHTER_API_KEY_ENCRYPTION_KEY,
-- AES-256-GCM, bound to network/account/key index); it is decrypted only
-- inside the Lighter signer worker thread.
ALTER TABLE "user_bots" ADD COLUMN IF NOT EXISTS "lighter_network" text;
ALTER TABLE "user_bots" ADD COLUMN IF NOT EXISTS "lighter_account_index" bigint;
ALTER TABLE "user_bots" ADD COLUMN IF NOT EXISTS "lighter_api_key_index" integer;
ALTER TABLE "user_bots" ADD COLUMN IF NOT EXISTS "lighter_api_public_key" text;
ALTER TABLE "user_bots" ADD COLUMN IF NOT EXISTS "lighter_api_key_enc" text;
-- "pending" (key generated + persisted, registration not yet confirmed on
-- Lighter) | "registered" (confirmed via /api/v1/apikeys).
ALTER TABLE "user_bots" ADD COLUMN IF NOT EXISTS "lighter_api_key_status" text;
ALTER TABLE "user_bots" ADD COLUMN IF NOT EXISTS "lighter_api_key_registered_at" timestamptz;
