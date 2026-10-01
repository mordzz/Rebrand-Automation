import { NextResponse } from "next/server";

import { getTrackedTokenIndex } from "@/lib/gmgn/track";
import { getRobinhoodAlpha } from "@/lib/alpha/robinhood-alpha";
import { getTokenMarkets } from "@/lib/sniper/token-market";

// The feed refreshes continuously - never cache this route.
export const dynamic = "force-dynamic";

/** Robinhood Chain alpha feed (lib/alpha/robinhood-alpha.ts), enriched with
 * DexScreener market data (address-based) and GMGN tracked-wallet activity
 * (chain=robinhood). */
export async function GET() {
  const { rows, error, refreshedAt } = await getRobinhoodAlpha();
  const [markets, trackedIndex] = await Promise.all([
    getTokenMarkets(rows.map((r) => r.token)),
    getTrackedTokenIndex(),
  ]);
  const data = rows.map((row) => {
    const tracked = trackedIndex.get(row.token);
    return {
      ...row,
      id: `robinhood:${row.token}`,
      market: markets.get(row.token) ?? null,
      tracked: tracked
        ? {
            buys: tracked.buys.length,
            sells: tracked.sells.length,
            names: [...tracked.buys, ...tracked.sells].slice(0, 3).map((t) => t.traderName),
          }
        : null,
    };
  });
  return NextResponse.json({
    configured: true,
    source: "robinhood",
    data,
    page: 1,
    pageSize: data.length,
    total: data.length,
    totalPages: 1,
    newestDetectedAt: data[0]?.detectedAt ?? null,
    refreshedAt,
    error,
  });
}
