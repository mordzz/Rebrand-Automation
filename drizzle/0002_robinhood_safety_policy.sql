-- PR06.5: additive Robinhood/EVM safety-policy columns on sniper_config.
--
-- Every statement is ADD COLUMN IF NOT EXISTS - safe to run against an
-- environment where these columns already exist (e.g. this repo's dev DB,
-- already updated via `drizzle-kit push` during PR06.5 development) and
-- safe to re-run. No existing column is renamed, dropped, or rewritten;
-- no row is inserted or deleted. Existing rows automatically receive the
-- column defaults below (true/true/NULL) - nothing is backfilled by hand
-- because there is nothing ambiguous to infer: a boolean DEFAULT applies
-- uniformly, and NULL correctly means "not yet configured" for every
-- existing row, not just new ones.

ALTER TABLE "sniper_config" ADD COLUMN IF NOT EXISTS "require_owner_renounced" boolean NOT NULL DEFAULT true;
ALTER TABLE "sniper_config" ADD COLUMN IF NOT EXISTS "require_no_blacklist_capability" boolean NOT NULL DEFAULT true;
ALTER TABLE "sniper_config" ADD COLUMN IF NOT EXISTS "max_creator_hold_pct" numeric;
