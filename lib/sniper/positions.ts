import { and, eq, isNull } from "drizzle-orm";

import { recordClosedTrade } from "@/lib/agent/record-trade";
import { getDb } from "@/lib/db";
import { positions, type Position } from "@/lib/db/schema";

/**
 * Remaining native notional after selling `sold` off a `current` amount,
 * never negative. Pure/exported so it is directly unit-testable without a
 * DB.
 */
export function computeRemainingSize(current: string | number, sold: number): number {
  return Math.max(Number(current) - sold, 0);
}

export type OpenPositionInput = {
  tokenAddress: string;
  symbol?: string;
  entryPrice: number;
  sizeNative: number;
  nativeSymbol: string;
  chain: string;
  network: string;
  tokensBought?: number;
  takeProfitPct: number;
  stopLossPct: number;
  /** null for a paper position - a simulated entry has no transaction. */
  entryTxHash: string | null;
  context?: Record<string, unknown>;
  /** null (default) = the house desk; set = one deployed bot's own ledger.
   * Same convention as trades.walletAddress (see app/api/positions/route.ts). */
  walletAddress?: string | null;
};

export async function openPosition(
  input: OpenPositionInput
): Promise<Position | null> {
  const db = getDb();
  if (!db) return null;

  const [row] = await db
    .insert(positions)
    .values({
      tokenAddress: input.tokenAddress,
      symbol: input.symbol,
      entryPrice: String(input.entryPrice),
      sizeNative: String(input.sizeNative),
      nativeSymbol: input.nativeSymbol,
      chain: input.chain,
      network: input.network,
      tokensBought:
        input.tokensBought != null ? String(input.tokensBought) : null,
      takeProfitPct: String(input.takeProfitPct),
      stopLossPct: String(input.stopLossPct),
      entryTxHash: input.entryTxHash,
      context: input.context ?? null,
      walletAddress: input.walletAddress ?? null,
    })
    .returning();
  return row;
}

/** Flips status to "closed" without recording another trade - used when a
 * tiered take-profit ladder's last tranche already sold the full remainder
 * (recordPartialExit already booked that tranche's trade). */
export async function markPositionClosed(id: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.update(positions).set({ status: "closed" }).where(eq(positions.id, id));
}

/** `walletAddress` null (default) scopes to the house desk; set scopes to
 * one deployed bot's own open positions - same null-means-house convention
 * as app/api/positions/route.ts. */
export async function getOpenPositions(
  walletAddress: string | null = null
): Promise<Position[]> {
  const db = getDb();
  if (!db) return [];
  return db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.status, "open"),
        walletAddress
          ? eq(positions.walletAddress, walletAddress)
          : isNull(positions.walletAddress)
      )
    );
}

/** Like getOpenPositions, but scoped to one chain - used by the Robinhood
 * risk gate so the deployed-native sum only ever includes that chain's
 * rows. `chain` is matched exactly. */
export async function getOpenPositionsByChain(
  walletAddress: string | null,
  chain: string
): Promise<Position[]> {
  const db = getDb();
  if (!db) return [];
  return db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.status, "open"),
        eq(positions.chain, chain),
        walletAddress
          ? eq(positions.walletAddress, walletAddress)
          : isNull(positions.walletAddress)
      )
    );
}

/** Bookkeeping only - used by the exit loop between TP/SL evaluations.
 * `peakPrice` is only passed once the trailing stop has activated. */
export async function updatePositionPrice(
  id: string,
  price: number,
  peakPrice?: number
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(positions)
    .set({
      lastPrice: String(price),
      lastCheckedAt: new Date(),
      ...(peakPrice != null ? { peakPrice: String(peakPrice) } : {}),
    })
    .where(eq(positions.id, id));
}

export type PartialExitInput = {
  /** Native amount notionally realized by this tranche (portion of the
   * position's remaining sizeNative at the moment this tier fired). */
  soldNative: number;
  exitPrice: number;
  /** null for a paper exit. */
  exitTxHash: string | null;
  pnlNative: number;
  /** Index into sniperConfig.takeProfitTiers - recorded so a tier never
   * fires twice on the same position. */
  tierIndex: number;
};

/** The closed-trade fields every exit shares, taken from the position.
 * `token` prefers the human-readable ticker - trades is the table the
 * dashboard's History tab reads from directly. */
function tradeBase(position: Position) {
  return {
    token: position.symbol ?? position.tokenAddress,
    strategy: position.strategy,
    entryPrice: Number(position.entryPrice),
    nativeSymbol: position.nativeSymbol,
    chain: position.chain,
    network: position.network,
    openedAt: position.openedAt.toISOString(),
    closedAt: new Date().toISOString(),
  };
}

/**
 * Books one take-profit tranche without closing the position - the
 * remainder keeps riding under the same exit rules. Tiered tranches are by
 * definition realized at a gain (a tier only fires above entry price), so
 * this never triggers analyzeLoss, same as any other winning trade.
 */
export async function recordPartialExit(
  position: Position,
  exit: PartialExitInput
): Promise<void> {
  const db = getDb();
  if (!db) return;

  await recordClosedTrade(
    {
      ...tradeBase(position),
      exitPrice: exit.exitPrice,
      sizeNative: exit.soldNative,
      pnlNative: exit.pnlNative,
      context: {
        ...((position.context as Record<string, unknown>) ?? {}),
        tokenAddress: position.tokenAddress,
        exitTxHash: exit.exitTxHash,
        exitReason: `tiered-take-profit-tier-${exit.tierIndex}`,
      },
    },
    position.walletAddress
  );

  const context = (position.context as Record<string, unknown>) ?? {};
  const triggeredTiers = Array.isArray(context.triggeredTiers)
    ? (context.triggeredTiers as number[])
    : [];
  const remainingSizeNative = computeRemainingSize(position.sizeNative, exit.soldNative);

  await db
    .update(positions)
    .set({
      sizeNative: String(remainingSizeNative),
      context: { ...context, triggeredTiers: [...triggeredTiers, exit.tierIndex] },
    })
    .where(eq(positions.id, position.id));
}

/**
 * Closes a position: records the closed trade (which triggers analyzeLoss
 * on a loss, same as the manual /api/trades flow) and marks the position
 * row closed.
 */
export async function closePosition(
  position: Position,
  exit: {
    exitPrice: number;
    /** null for a paper exit. */
    exitTxHash: string | null;
    pnlNative: number;
    reason: string;
  }
): Promise<void> {
  const db = getDb();
  if (!db) return;

  await recordClosedTrade(
    {
      ...tradeBase(position),
      exitPrice: exit.exitPrice,
      sizeNative: Number(position.sizeNative),
      pnlNative: exit.pnlNative,
      context: {
        ...((position.context as Record<string, unknown>) ?? {}),
        tokenAddress: position.tokenAddress,
        exitTxHash: exit.exitTxHash,
        exitReason: exit.reason,
      },
    },
    position.walletAddress
  );

  await db
    .update(positions)
    .set({ status: "closed" })
    .where(eq(positions.id, position.id));
}
