import { and, desc, eq, gte, lt } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { trades, type Trade } from "@/lib/db/schema";

/**
 * Per-wallet trade aggregates backing the derived (not persisted) per-user
 * circuit breaker — see deriveTradingPause in lib/sniper/risk-limits.ts.
 * Three independently-scoped queries rather than one row-limited query
 * sliced three ways: a win after the wallet's last loss would otherwise
 * hide that loss from a "recent N rows" list, and an active trader closing
 * more than the row limit in a day would silently undercount drawdown.
 * Backed by the trades(wallet_address, closed_at) index.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Recent closed trades for one wallet, most recent first — walked to
 * derive the consecutive-loss streak (strict pnlSol < 0, matching the
 * house's own sniper_state.consecutiveLosses semantics: a pnlSol === 0
 * trade resets the streak, same as a win).
 *
 * `since`, when set, excludes trades closed at or before it — this is
 * userBots.breakerResetAt (see schema comment): a manual breaker reset
 * makes pause derivation ignore everything before the reset moment rather
 * than rewriting or deleting trade history. */
export async function getRecentOutcomes(
  wallet: string,
  limit = 50,
  since: Date | null = null
): Promise<Trade[]> {
  const db = getDb();
  if (!db) return [];
  return db
    .select()
    .from(trades)
    .where(
      since
        ? and(eq(trades.walletAddress, wallet), gte(trades.closedAt, since))
        : eq(trades.walletAddress, wallet)
    )
    .orderBy(desc(trades.closedAt))
    .limit(limit);
}

/** Rolling 24h realized P&L for one wallet — deliberately a rolling window
 * from now, not a calendar day. Simpler than, and avoids the timezone /
 * anchor-drift ambiguity of, the house's own sniper_state.dailyPnlResetAt
 * approach. `since` (see getRecentOutcomes) further narrows the window when
 * a breaker reset is more recent than 24h ago. */
export async function getDailyPnlSol(wallet: string, since: Date | null = null): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const windowStart = new Date(Date.now() - DAY_MS);
  const effectiveSince = since && since > windowStart ? since : windowStart;
  const rows = await db
    .select({ pnlSol: trades.pnlSol })
    .from(trades)
    .where(and(eq(trades.walletAddress, wallet), gte(trades.closedAt, effectiveSince)));
  return rows.reduce((sum, row) => sum + Number(row.pnlSol), 0);
}

/** Most recent loss for one wallet, if any. Its own targeted query, not
 * derived from getRecentOutcomes — a win after the last loss would
 * otherwise hide it, breaking cooldown-after-loss. `since` (see
 * getRecentOutcomes) excludes losses at or before a breaker reset. */
export async function getLastLossAt(wallet: string, since: Date | null = null): Promise<Date | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ closedAt: trades.closedAt })
    .from(trades)
    .where(
      since
        ? and(eq(trades.walletAddress, wallet), lt(trades.pnlSol, "0"), gte(trades.closedAt, since))
        : and(eq(trades.walletAddress, wallet), lt(trades.pnlSol, "0"))
    )
    .orderBy(desc(trades.closedAt))
    .limit(1);
  return row?.closedAt ?? null;
}
