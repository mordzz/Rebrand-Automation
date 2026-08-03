import { NextResponse } from "next/server";

import { getMarketPrices, SUPPORTED_MARKETS } from "@/lib/perps/markets";

export const dynamic = "force-dynamic";

/** Curated Drift market list for the create-token market picker. Price
 * fields come from Pyth's Hermes API (see
 * lib/perps/markets.ts#getMarketPrices); null only on an upstream
 * fetch failure — never fabricated. */
export async function GET() {
  const prices = await getMarketPrices();
  const data = SUPPORTED_MARKETS.map((m) => ({
    ...m,
    ...(prices.get(m.symbol) ?? { markPrice: null, change24h: null }),
  }));
  return NextResponse.json({ configured: true, data });
}
