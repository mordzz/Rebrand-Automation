import { and, eq, gte, isNull } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { positions, trades, userBots } from "@/lib/db/schema";
import { robinhoodBreakerStatus, summarizePnl, tradeWon } from "@/lib/agent/bot-summary";
import { getEffectiveConfig } from "@/lib/sniper/effective-config";

// Stats are derived from live position/trade rows - never cache this route.
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/** `?wallet=` scopes every figure to one deployed bot's own ledger;
 * omitted means the house desk - see app/api/positions/route.ts for the
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

  const [openPositions, trades24h, trades30d, bot] = await Promise.all([
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
    wallet
      ? db.select().from(userBots).where(eq(userBots.walletAddress, wallet)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  // Per-wallet circuit breaker - re-derived fresh, not persisted, so a
  // deployed bot's /deploy page can show *why* it stopped trading rather
  // than just going quiet. House-desk requests (no `wallet`) skip this;
  // there is no per-bot switch or breaker there.
  let breaker: { tradingPaused: boolean; pauseReason: string | null } | null = null;
  if (wallet && bot) {
    const config = await getEffectiveConfig(bot);
    // Same breaker scripts/paper-daemon.ts enforces.
    breaker = await robinhoodBreakerStatus(wallet, bot.breakerResetAt, config);
  }

  const openPositionsInProfit = openPositions.filter((p) => {
    if (p.lastPrice == null) return false;
    return Number(p.lastPrice) > Number(p.entryPrice);
  }).length;

  const pnl24h = summarizePnl(trades24h);

  const wins30d = trades30d.filter(tradeWon).length;
  const winRate30d =
    trades30d.length > 0 ? (wins30d / trades30d.length) * 100 : null;

  return NextResponse.json({
    configured: true,
    openPositionsCount: openPositions.length,
    openPositionsInProfit,
    pnl24hNative: pnl24h.pnlNative,
    nativeSymbol: pnl24h.nativeSymbol,
    winRate30d,
    trades30dCount: trades30d.length,
    wins30dCount: wins30d,
    // The operator's own on/off switch (app/api/my-bot/toggle), separate
    // from tradingPaused below (the safety circuit breaker) - house-desk
    // requests (no `wallet`) have no such switch, so this is always true.
    active: wallet ? (bot?.active ?? false) : true,
    tradingMode: wallet ? (bot?.tradingMode ?? "paper") : "live",
    tradingPaused: breaker?.tradingPaused ?? false,
    pauseReason: breaker?.pauseReason ?? null,
  });
}
