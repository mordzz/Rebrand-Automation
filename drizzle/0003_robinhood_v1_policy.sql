-- PR07-pre: finalize the approved Robinhood v1 creator-hold default.
--
-- Product decision: maxCreatorHoldPct = 10 (Robinhood, current-holding
-- ceiling) is now the approved default, replacing the PR06.5
-- "unconfigured/configuration-blocker" NULL default. Additive/safe to
-- run on top of drizzle/0002_robinhood_safety_policy.sql regardless of
-- whether that migration has already been applied - this only touches
-- rows/defaults, adds no columns, drops nothing.
--
-- Explicitly configured non-null values are preserved: the backfill only
-- targets rows that are still NULL (i.e. never explicitly set away from
-- the PR06.5 default). No existing row is deleted; row count is
-- unaffected.

-- Backfill existing rows that are still unconfigured.
UPDATE "sniper_config"
SET "max_creator_hold_pct" = '10'
WHERE "max_creator_hold_pct" IS NULL;

-- Future rows (new installs) get 10 automatically.
ALTER TABLE "sniper_config" ALTER COLUMN "max_creator_hold_pct" SET DEFAULT '10';
