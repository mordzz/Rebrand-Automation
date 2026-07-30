import { and, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { trades, userBots } from "@/lib/db/schema";
import { getEffectiveConfig } from "@/lib/sniper/effective-config";
import { getOpenPositions } from "@/lib/sniper/positions";
import { deriveTradingPause } from "@/lib/sniper/risk-limits";
import { getDailyPnlSol, getLastLossAt, getRecentOutcomes } from "@/lib/sniper/wallet-trade-stats";
import { redactPauseReason } from "@/lib/agent/agent-chat";
import { marketCapsForPositions } from "@/lib/sniper/market-cap";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function shortAddress(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/**
 * The Fleet, public directory view (whitepaper §14): every deployed agent,
 * its performance, and its open positions — read-only, no wallet login
 * required, same "publicly watchable" posture as /alpha. Operator wallets
 * are shown short-form only (never the full address) to stay closer to the
 * whitepaper's "operator identity is not public" line while this remains a
 * demo-stage, all-paper fleet.
 */
export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ configured: false, agents: [] });

  const bots = await db.select().from(userBots).orderBy(desc(userBots.createdAt));
  const since24h = new Date(Date.now() - DAY_MS);
  const since30d = new Date(Date.now() - 30 * DAY_MS);

  const agents = await Promise.all(
    bots.map(async (bot) => {
      const wallet = bot.walletAddress;
      const [config, openPositions, trades24h, trades30d, recentOutcomes, dailyPnlSol, lastLossAt] =
        await Promise.all([
          getEffectiveConfig(bot),
          getOpenPositions(wallet),
          db
            .select()
            .from(trades)
            .where(and(eq(trades.walletAddress, wallet), gte(trades.closedAt, since24h))),
          db
            .select()
            .from(trades)
            .where(and(eq(trades.walletAddress, wallet), gte(trades.closedAt, since30d))),
          getRecentOutcomes(wallet, 50, bot.breakerResetAt),
          getDailyPnlSol(wallet, bot.breakerResetAt),
          getLastLossAt(wallet, bot.breakerResetAt),
        ]);


      const capsByMint = await marketCapsForPositions(openPositions);
      const pnl24hSol = trades24h.reduce((sum, t) => sum + Number(t.pnlSol), 0);
      const wins30d = trades30d.filter((t) => Number(t.pnlSol) > 0).length;
      const winRate30d = trades30d.length > 0 ? (wins30d / trades30d.length) * 100 : null;
      const breaker = deriveTradingPause({ recentOutcomes, dailyPnlSol, lastLossAt }, config);

      return {
        id: bot.id,
        name: bot.name,
        characterType: bot.characterType,
        characterSrc: bot.characterSrc,
        walletShort: shortAddress(wallet),
        deployedAt: bot.createdAt,
        active: bot.active,
        tradingPaused: breaker.tradingPaused,
        // Category only — the raw reason embeds a configured
        // threshold, and this payload is public. See redactPauseReason.
        pauseReason: redactPauseReason(breaker.pauseReason),
        pnl24hSol,
        winRate30d,
        trades30dCount: trades30d.length,
        openPositions: openPositions.map((p) => {
          /* Market cap alongside the raw price: a per-token figure like
             5.76e-8 SOL says nothing about whether an entry was early or
             late, and cap is the unit this market is actually read in. */
          const caps = capsByMint.get(p.token);
          return {
            id: p.id,
            token: p.token,
            symbol: p.symbol,
            strategy: p.strategy,
            entryPrice: p.entryPrice,
            sizeSol: p.sizeSol,
            lastPrice: p.lastPrice,
            openedAt: p.openedAt,
            entryMarketCapUsd: caps?.entryUsd ?? null,
            currentMarketCapUsd: caps?.currentUsd ?? null,
          };
        }),
      };
    })
  );

  return NextResponse.json({ configured: true, agents });
}
