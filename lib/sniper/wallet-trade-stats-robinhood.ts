import { and, desc, eq, gte, lt } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { trades, type Trade } from "@/lib/db/schema";

/**
 * Per-wallet trade statistics for the Robinhood circuit breaker. Every
 * query filters `trades.chain = "robinhood"` and reads `pnlNative`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getRecentRobinhoodOutcomes(
  wallet: string,
  limit = 50,
  since: Date | null = null
): Promise<Trade[]> {
  const db = getDb();
  if (!db) return [];
  const chainFilter = eq(trades.chain, "robinhood");
  return db
    .select()
    .from(trades)
    .where(
      since
        ? and(eq(trades.walletAddress, wallet), chainFilter, gte(trades.closedAt, since))
        : and(eq(trades.walletAddress, wallet), chainFilter)
    )
    .orderBy(desc(trades.closedAt))
    .limit(limit);
}

/** Rolling 24h realized ETH P&L for one wallet's Robinhood trades only. */
export async function getDailyPnlNativeRobinhood(
  wallet: string,
  since: Date | null = null
): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const windowStart = new Date(Date.now() - DAY_MS);
  const effectiveSince = since && since > windowStart ? since : windowStart;
  const rows = await db
    .select({ pnlNative: trades.pnlNative })
    .from(trades)
    .where(
      and(
        eq(trades.walletAddress, wallet),
        eq(trades.chain, "robinhood"),
        gte(trades.closedAt, effectiveSince)
      )
    );
  return rows.reduce((sum, row) => sum + Number(row.pnlNative ?? 0), 0);
}

export async function getLastLossAtRobinhood(
  wallet: string,
  since: Date | null = null
): Promise<Date | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ closedAt: trades.closedAt })
    .from(trades)
    .where(
      since
        ? and(
            eq(trades.walletAddress, wallet),
            eq(trades.chain, "robinhood"),
            lt(trades.pnlNative, "0"),
            gte(trades.closedAt, since)
          )
        : and(
            eq(trades.walletAddress, wallet),
            eq(trades.chain, "robinhood"),
            lt(trades.pnlNative, "0")
          )
    )
    .orderBy(desc(trades.closedAt))
    .limit(1);
  return row?.closedAt ?? null;
}
