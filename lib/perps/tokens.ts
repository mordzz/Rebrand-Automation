import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { perpspadTokens, type PerpspadToken as PerpspadTokenRow } from "@/drizzle/schema";
import type { PerpspadToken, PerpsDirection } from "./perpspad-types";
import { SUPPORTED_MARKETS } from "./markets";

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** DB row → the shape components/perps/* already render. Only maps
 * fields this table actually stores - `unrealizedPnl`/`effectiveLeverage`
 * are left undefined rather than derived from partial inputs, since a
 * wrong-but-plausible-looking P&L number is worse than a "-" in the UI.
 * Phase 2+'s keeper is the right place to decide whether those become
 * their own stored columns once there's real position data to compute
 * them from. */
function toApiToken(row: PerpspadTokenRow): PerpspadToken {
  const marketIndex = num(row.underlyingMarketIndex) ?? 0;
  const market = SUPPORTED_MARKETS.find((m) => m.marketIndex === marketIndex);

  return {
    id: row.id,
    mint: row.mint,
    name: row.name,
    symbol: row.symbol,
    underlying: market?.symbol ?? "?",
    underlyingMarketIndex: marketIndex,
    direction: row.direction as PerpsDirection,
    targetLeverage: num(row.targetLeverage) ?? 0,
    driftAuthorityPda: row.driftSubaccountAuthority,
    status: row.status as PerpspadToken["status"],
    entryPrice: num(row.entryPrice) ?? undefined,
    currentPrice: num(row.currentPrice) ?? undefined,
    collateral: num(row.collateralUsdc) ?? undefined,
    healthRatio: num(row.healthRatio) ?? undefined,
    pendingFees: num(row.pendingFeesUsdc) ?? undefined,
    totalFeesCollected: num(row.totalFeesCollectedUsdc) ?? undefined,
    totalBurned: num(row.totalBurnedTokens) ?? undefined,
    createdAt: row.createdAt.getTime(),
  };
}

/** Every launched token, newest first - powers the "Launched Tokens" tab.
 * Empty array (not an error) when the DB isn't configured, same
 * graceful-degrade shape as app/api/positions. */
export async function getPerpspadTokens(limit = 50): Promise<PerpspadToken[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select()
      .from(perpspadTokens)
      .orderBy(desc(perpspadTokens.createdAt))
      .limit(limit);
    return rows.map(toApiToken);
  } catch (error) {
    console.warn("Database error in getPerpspadTokens:", error);
    return [];
  }
}

export async function getPerpspadTokenByMint(
  mint: string
): Promise<PerpspadToken | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select()
      .from(perpspadTokens)
      .where(eq(perpspadTokens.mint, mint))
      .limit(1);
    return row ? toApiToken(row) : null;
  } catch (error) {
    console.warn("Database error in getPerpspadTokenByMint:", error);
    return null;
  }
}
