import { and, eq, isNull } from "drizzle-orm";

import { recordClosedTrade } from "@/lib/agent/record-trade";
import { getDb } from "@/lib/db";
import { positions, type Position } from "@/lib/db/schema";

export type OpenPositionInput = {
  /** Legacy required column — for Robinhood callers this is a
   * compatibility shadow: the same EVM token address that also goes into
   * `tokenAddress` below, since `positions.token` is NOT NULL and this
   * repo does not perform destructive migrations. Never itself read for
   * Robinhood decision-making — see tokenAddress. */
  token: string;
  symbol?: string;
  entryPrice: number;
  /** Legacy required column — for Robinhood callers this is a
   * compatibility shadow holding the same numeric value as `sizeNative`
   * below (an ETH notional, not SOL). Never itself read for Robinhood
   * risk/sizing decisions — see sizeNative. */
  sizeSol: number;
  tokensBought?: number;
  takeProfitPct: number;
  stopLossPct: number;
  /** Legacy required column — for Robinhood paper positions this is the
   * literal "paper" sentinel, same convention as the Solana path. Never
   * a real Robinhood transaction hash — see entryTxHash. */
  entryTxSignature: string;
  context?: Record<string, unknown>;
  /** null (default) = the house desk; set = one deployed bot's own ledger.
   * Same convention as trades.walletAddress (see app/api/positions/route.ts). */
  walletAddress?: string | null;

  /* PR04 chain-neutral columns (PR07 is the first writer). All optional —
   * Solana callers omit them entirely and every one stays NULL, exactly
   * as before this PR. A Robinhood caller sets every field below;
   * `entryTxHash` stays null for a paper simulation (never the "paper"
   * string — that sentinel is entryTxSignature-only, the legacy shadow
   * column above). */
  tokenAddress?: string | null;
  sizeNative?: number | null;
  nativeSymbol?: string | null;
  chain?: string | null;
  network?: string | null;
  entryTxHash?: string | null;
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
      walletAddress: input.walletAddress ?? null,
      tokenAddress: input.tokenAddress ?? null,
      sizeNative: input.sizeNative != null ? String(input.sizeNative) : null,
      nativeSymbol: input.nativeSymbol ?? null,
      chain: input.chain ?? null,
      network: input.network ?? null,
      entryTxHash: input.entryTxHash ?? null,
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

/** `walletAddress` null (default) scopes to the house desk; set scopes to
 * one deployed bot's own open positions — same null-means-house convention
 * as app/api/positions/route.ts. Callers must always pass the same wallet
 * scope they intend to manage: mixing house and per-user positions in one
 * loop would let one daemon close another's positions out from under it. */
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

/** Like getOpenPositions, but scoped to one chain — used by PR07's
 * Robinhood risk gate so a deployed-native sum can never accidentally
 * include Solana rows (chain=null/"solana"), and so a Solana-only
 * consumer is never handed a Robinhood row. `chain` is matched exactly
 * (no fallback/guessing for legacy null rows). */
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

  /* PR04 chain-neutral trade fields — optional, Robinhood-only. Solana
   * callers omit these; recordClosedTrade below then leaves them null,
   * unchanged from before this PR. See closePosition's identical block
   * for the shared rationale. */
  sizeNative?: number | null;
  pnlNative?: number | null;
  nativeSymbol?: string | null;
  chain?: string | null;
  network?: string | null;
  tokenAddress?: string | null;
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

  await recordClosedTrade(
    {
      token: position.symbol ?? position.token,
      strategy: position.strategy,
      entryPrice: Number(position.entryPrice),
      exitPrice: exit.exitPrice,
      sizeSol: exit.soldSol,
      pnlSol: exit.pnlSol,
      sizeNative: exit.sizeNative ?? null,
      pnlNative: exit.pnlNative ?? null,
      nativeSymbol: exit.nativeSymbol ?? null,
      chain: exit.chain ?? null,
      network: exit.network ?? null,
      openedAt: position.openedAt.toISOString(),
      closedAt: new Date().toISOString(),
      context: {
        ...((position.context as Record<string, unknown>) ?? {}),
        mint: position.token,
        tokenAddress: exit.tokenAddress ?? null,
        exitTxSignature: exit.exitTxSignature,
        exitReason: `tiered-take-profit-tier-${exit.tierIndex}`,
      },
    },
    position.walletAddress
  );

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

    /* PR04 chain-neutral trade fields — optional, Robinhood-only. Solana
     * callers (scripts/paper-daemon.ts's existing exit path) omit these
     * entirely; recordClosedTrade then writes null for every one, exactly
     * as before this PR. A Robinhood caller supplies the ETH-denominated
     * counterparts alongside the legacy sizeSol/pnlSol shadow values
     * above (see closePosition's caller in scripts/paper-daemon.ts for
     * how sizeSol/pnlSol get their compatibility-shadow numbers). */
    sizeNative?: number | null;
    pnlNative?: number | null;
    nativeSymbol?: string | null;
    chain?: string | null;
    network?: string | null;
    tokenAddress?: string | null;
  }
): Promise<void> {
  const db = getDb();
  if (!db) return;

  await recordClosedTrade(
    {
      // Prefer the human-readable ticker over the raw mint address — trades
      // is the table the dashboard's History tab reads from directly.
      token: position.symbol ?? position.token,
      strategy: position.strategy,
      entryPrice: Number(position.entryPrice),
      exitPrice: exit.exitPrice,
      sizeSol: Number(position.sizeSol),
      pnlSol: exit.pnlSol,
      sizeNative: exit.sizeNative ?? null,
      pnlNative: exit.pnlNative ?? null,
      nativeSymbol: exit.nativeSymbol ?? null,
      chain: exit.chain ?? null,
      network: exit.network ?? null,
      openedAt: position.openedAt.toISOString(),
      closedAt: new Date().toISOString(),
      context: {
        ...((position.context as Record<string, unknown>) ?? {}),
        mint: position.token,
        tokenAddress: exit.tokenAddress ?? null,
        exitTxSignature: exit.exitTxSignature,
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
