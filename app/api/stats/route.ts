import { and, eq, gte, isNull } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { positions, trades } from "@/lib/db/schema";

// Stats are derived from live position/trade rows — never cache this route.
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/** `?wallet=` scopes every figure to one deployed bot's own ledger;
 * omitted means the house desk — see app/api/positions/route.ts for the
 * same null-means-house convention. */
export async function GET(request: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ configured: false });
  }

  const wallet = request.nextUrl.searchParams.get("wallet");
  const positionsWalletFilter = wallet
    ? eq(positions.walletAddress, wallet)
    : isNull(positions.walletAddress);
  const tradesWalletFilter = wallet
    ? eq(trades.walletAddress, wallet)
    : isNull(trades.walletAddress);

  const since24h = new Date(Date.now() - DAY_MS);
  const since30d = new Date(Date.now() - 30 * DAY_MS);

  const [openPositions, trades24h, trades30d] = await Promise.all([
    db
      .select()
      .from(positions)
      .where(and(eq(positions.status, "open"), positionsWalletFilter)),
    db
      .select()
      .from(trades)
      .where(and(gte(trades.closedAt, since24h), tradesWalletFilter)),
    db
      .select()
      .from(trades)
      .where(and(gte(trades.closedAt, since30d), tradesWalletFilter)),
  ]);

  const openPositionsInProfit = openPositions.filter((p) => {
    if (p.lastPrice == null) return false;
    return Number(p.lastPrice) > Number(p.entryPrice);
  }).length;

  const pnl24hSol = trades24h.reduce((sum, t) => sum + Number(t.pnlSol), 0);

  const wins30d = trades30d.filter((t) => Number(t.pnlSol) > 0).length;
  const winRate30d =
    trades30d.length > 0 ? (wins30d / trades30d.length) * 100 : null;

  return NextResponse.json({
    configured: true,
    openPositionsCount: openPositions.length,
    openPositionsInProfit,
    pnl24hSol,
    winRate30d,
    trades30dCount: trades30d.length,
    wins30dCount: wins30d,
  });
}
