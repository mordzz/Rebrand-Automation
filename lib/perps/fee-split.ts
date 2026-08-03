import { getDb } from "@/lib/db";
import { perpspadConfig } from "@/lib/db/schema";
import { DEFAULT_FEE_SPLIT, type FeeSplitConfig } from "./perpspad-types";

/** Basis points, sum must be exactly 10000 — the app-level half of the
 * same belt-and-suspenders pair as the DB CHECK on perpspad_config
 * (perpspad_config_fee_split_sums_to_10000). Both must independently
 * agree; this is the one called from application code (the config route,
 * the seed default), the DB CHECK is what still holds even if a caller
 * forgets to run this. */
export function assertValidFeeSplit(bps: {
  collateral: number;
  tokenBurn: number;
  govBurn: number;
}): void {
  const sum = bps.collateral + bps.tokenBurn + bps.govBurn;
  if (sum !== 10000) {
    throw new Error(
      `Fee split must sum to 10000 bps (100%), got ${sum} (${bps.collateral}/${bps.tokenBurn}/${bps.govBurn})`
    );
  }
}

function bpsToPct(bps: number): number {
  return bps / 100;
}

/**
 * The current 50/25/25-style fee split. Reads the singleton
 * `perpspad_config` row when the DB is configured, falling back to
 * `DEFAULT_FEE_SPLIT` otherwise — the one place every fee-split render
 * site (the flow diagram, the create-token preview, the config API
 * route) should call, instead of each hardcoding its own copy of the
 * same three numbers the way the original mockup did.
 *
 * Source-of-truth note: this table is authoritative only until the
 * Phase 1 on-chain Config account exists — from then on this becomes a
 * read-cache synced FROM chain, not edited independently (see
 * lib/db/schema.ts#perpspadConfig).
 */
export async function getFeeSplitConfig(): Promise<FeeSplitConfig> {
  const db = getDb();
  if (!db) return DEFAULT_FEE_SPLIT;

  const [row] = await db.select().from(perpspadConfig).limit(1);
  if (!row) return DEFAULT_FEE_SPLIT;

  return {
    collateralTopUp: bpsToPct(Number(row.feeSplitCollateralBps)),
    tokenBuybackBurn: bpsToPct(Number(row.feeSplitTokenBurnBps)),
    governanceBuybackBurn: bpsToPct(Number(row.feeSplitGovBurnBps)),
  };
}

const DEFAULT_KEEPER_INTERVAL_MS = 60_000;

/** Public config surface for the UI: fee split + keeper cadence. No
 * write path on this yet (GET-only route) — defer PATCH until there's a
 * real admin-auth story, per the Perpspad plan. */
export async function getPerpspadPublicConfig(): Promise<{
  feeSplit: FeeSplitConfig;
  keeperIntervalMs: number;
}> {
  const db = getDb();
  if (!db) {
    return { feeSplit: DEFAULT_FEE_SPLIT, keeperIntervalMs: DEFAULT_KEEPER_INTERVAL_MS };
  }

  const [row] = await db.select().from(perpspadConfig).limit(1);
  return {
    feeSplit: row
      ? {
          collateralTopUp: bpsToPct(Number(row.feeSplitCollateralBps)),
          tokenBuybackBurn: bpsToPct(Number(row.feeSplitTokenBurnBps)),
          governanceBuybackBurn: bpsToPct(Number(row.feeSplitGovBurnBps)),
        }
      : DEFAULT_FEE_SPLIT,
    keeperIntervalMs: row ? Number(row.keeperIntervalMs) : DEFAULT_KEEPER_INTERVAL_MS,
  };
}
