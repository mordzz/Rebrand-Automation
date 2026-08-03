import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { perpspadTokens, type PerpspadToken as PerpspadTokenRow } from "@/lib/db/schema";
import type { PerpspadToken, PerpsDirection } from "./perpspad-types";
import { getMarketBySymbol, SUPPORTED_MARKETS } from "./markets";

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** DB row → the shape components/perps/* already render. Only maps
 * fields this table actually stores — `unrealizedPnl`/`effectiveLeverage`
 * are left undefined rather than derived from partial inputs, since a
 * wrong-but-plausible-looking P&L number is worse than a "—" in the UI.
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

/** Every launched token, newest first — powers the "Launched Tokens" tab.
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

/** Records a token that already exists on-chain. Every field comes from
 * the program's own `PerpToken` account (see lib/perps/onchain.ts), so
 * this is a mirror of chain state rather than a claim a caller made.
 * Idempotent on `mint`: re-submitting the same launch updates the row
 * instead of creating a second one or erroring on the unique index. */
export async function ingestOnChainToken(input: {
  mint: string;
  perpTokenPda: string;
  driftAuthorityPda: string;
  creator: string;
  name: string;
  symbol: string;
  underlyingMarketIndex: number;
  direction: PerpsDirection;
  targetLeverage: number;
  status: string;
}): Promise<PerpspadToken> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");

  const values = {
    mint: input.mint,
    name: input.name,
    symbol: input.symbol,
    underlyingMarketIndex: String(input.underlyingMarketIndex),
    direction: input.direction,
    targetLeverage: String(input.targetLeverage),
    creatorWallet: input.creator,
    programTokenPda: input.perpTokenPda,
    driftSubaccountAuthority: input.driftAuthorityPda,
    status: input.status,
  };

  const [row] = await db
    .insert(perpspadTokens)
    .values(values)
    .onConflictDoUpdate({
      target: perpspadTokens.mint,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  return toApiToken(row);
}

export type CreatePendingTokenInput = {
  name: string;
  symbol: string;
  underlying: string; // market symbol, resolved to a real index here
  direction: PerpsDirection;
  targetLeverage: number;
  creatorWallet: string;
};

/** Phase 0 only: records a creator's intent, no chain interaction. Once
 * Phase 1/2 land, token creation becomes a user-signed on-chain
 * `register_token` transaction and this function's role shifts to
 * "verify+ingest a signature" — see app/api/perps/tokens/route.ts. */
export async function createPendingPerpspadToken(
  input: CreatePendingTokenInput
): Promise<PerpspadToken> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");

  const market = getMarketBySymbol(input.underlying);
  if (!market) {
    throw new Error(`Unsupported underlying market: ${input.underlying}`);
  }

  const [row] = await db
    .insert(perpspadTokens)
    .values({
      name: input.name,
      symbol: input.symbol,
      underlyingMarketIndex: String(market.marketIndex),
      direction: input.direction,
      targetLeverage: String(input.targetLeverage),
      creatorWallet: input.creatorWallet,
      status: "pending",
    })
    .returning();

  return toApiToken(row);
}
