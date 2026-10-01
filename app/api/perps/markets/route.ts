import { NextResponse } from "next/server";

import { LighterClient } from "@/lib/lighter/client";
import { getMarketLogo } from "@/lib/perps/markets";

export const dynamic = "force-dynamic";

/** Active Lighter (Robinhood Chain) perp markets for the ticker and the
 * market picker — PR11. Same response shape as the retired Drift list;
 * `marketIndex` is now Lighter's `market_id` and prices are Lighter's own
 * mark price. On a Lighter outage the list is empty with an error — never
 * a stale or fabricated price. (Historical Perpspad rows still resolve
 * against the Drift list in lib/perps/markets.ts.) */
export async function GET() {
  try {
    const markets = await new LighterClient().getMarkets();
    const data = markets
      .filter((m) => m.status === "active")
      .map((m) => {
        const mark = Number(m.markPrice);
        return {
          symbol: m.symbol,
          name: m.symbol,
          marketIndex: m.marketId,
          logoUri: getMarketLogo(m.symbol),
          markPrice: Number.isFinite(mark) && mark > 0 ? mark : null,
          change24h: m.dailyPriceChangePct,
        };
      });
    return NextResponse.json({ configured: true, venue: "lighter", data });
  } catch (error) {
    return NextResponse.json(
      { configured: true, venue: "lighter", data: [], error: error instanceof Error ? error.message : "Lighter unavailable" },
      { status: 503 },
    );
  }
}
