import { eq } from "drizzle-orm";

import { recordClosedTrade } from "@/lib/agent/record-trade";
import { getDb } from "@/lib/db";
import { positions, type Position } from "@/lib/db/schema";

export type OpenPositionInput = {
  token: string;
  symbol?: string;
  entryPrice: number;
  sizeSol: number;
  tokensBought?: number;
  takeProfitPct: number;
  stopLossPct: number;
  entryTxSignature: string;
  context?: Record<string, unknown>;
};

/**
 * Only called after signAndSendRawTransaction already returned a
 * confirmed signature — if the buy itself fails, the caller (the daemon)
 * just logs it and moves on; there's nothing to record here since no
 * position was ever actually opened on-chain.
 */
export async function openPosition(
  input: OpenPositionInput
): Promise<Position | null> {
  const db = getDb();
  if (!db) return null;

  const [row] = await db
    .insert(positions)
    .values({
      token: input.token,
      symbol: input.symbol,
      entryPrice: String(input.entryPrice),
      sizeSol: String(input.sizeSol),
      tokensBought:
        input.tokensBought != null ? String(input.tokensBought) : null,
      takeProfitPct: String(input.takeProfitPct),
      stopLossPct: String(input.stopLossPct),
      entryTxSignature: input.entryTxSignature,
      context: input.context ?? null,
    })
    .returning();
  return row;
}

/** Flips status to "closed" without recording another trade — used when a
 * tiered take-profit ladder's last tranche already sold the full remainder
 * (recordPartialExit already booked that tranche's trade). */
export async function markPositionClosed(id: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.update(positions).set({ status: "closed" }).where(eq(positions.id, id));
}

export async function getOpenPositions(): Promise<Position[]> {
  const db = getDb();
  if (!db) return [];
  return db.select().from(positions).where(eq(positions.status, "open"));
}

/** Bookkeeping only — used by the exit loop between TP/SL evaluations.
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
  /** SOL notionally realized by this tranche (portion of the position's
   * remaining sizeSol at the moment this tier fired). */
  soldSol: number;
  exitPrice: number;
  exitTxSignature: string;
  pnlSol: number;
  /** Index into sniperConfig.takeProfitTiers — recorded so a tier never
   * fires twice on the same position. */
  tierIndex: number;
};

/**
 * Books one take-profit tranche without closing the position — the
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

  await recordClosedTrade({
    token: position.symbol ?? position.token,
    strategy: position.strategy,
    entryPrice: Number(position.entryPrice),
    exitPrice: exit.exitPrice,
    sizeSol: exit.soldSol,
    pnlSol: exit.pnlSol,
    openedAt: position.openedAt.toISOString(),
    closedAt: new Date().toISOString(),
    context: {
      ...((position.context as Record<string, unknown>) ?? {}),
      mint: position.token,
      exitTxSignature: exit.exitTxSignature,
      exitReason: `tiered-take-profit-tier-${exit.tierIndex}`,
    },
  });

  const context = (position.context as Record<string, unknown>) ?? {};
  const triggeredTiers = Array.isArray(context.triggeredTiers)
    ? (context.triggeredTiers as number[])
    : [];
  const remainingSizeSol = Math.max(Number(position.sizeSol) - exit.soldSol, 0);

  await db
    .update(positions)
    .set({
      sizeSol: String(remainingSizeSol),
      context: { ...context, triggeredTiers: [...triggeredTiers, exit.tierIndex] },
    })
    .where(eq(positions.id, position.id));
}

/**
 * Closes a position after a real sell: records the closed trade (which
 * triggers analyzeLoss on a loss, same as the existing manual /api/trades
 * flow) and marks the position row closed.
 */
export async function closePosition(
  position: Position,
  exit: {
    exitPrice: number;
    exitTxSignature: string;
    pnlSol: number;
    reason: string;
  }
): Promise<void> {
  const db = getDb();
  if (!db) return;

  await recordClosedTrade({
    // Prefer the human-readable ticker over the raw mint address — trades
    // is the table the dashboard's History tab reads from directly.
    token: position.symbol ?? position.token,
    strategy: position.strategy,
    entryPrice: Number(position.entryPrice),
    exitPrice: exit.exitPrice,
    sizeSol: Number(position.sizeSol),
    pnlSol: exit.pnlSol,
    openedAt: position.openedAt.toISOString(),
    closedAt: new Date().toISOString(),
    context: {
      ...((position.context as Record<string, unknown>) ?? {}),
      mint: position.token,
      exitTxSignature: exit.exitTxSignature,
      exitReason: exit.reason,
    },
  });

  await db
    .update(positions)
    .set({ status: "closed" })
    .where(eq(positions.id, position.id));
}
