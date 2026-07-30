import { NextResponse } from "next/server";

import { isGmgnConfigured } from "@/lib/gmgn/client";
import { getTrackedTrades } from "@/lib/gmgn/track";

// Real-time wallet activity — never cache at the framework level; the
// upstream call is already throttled by a short in-process cache.
export const dynamic = "force-dynamic";

/** Live KOL and smart-money trades from GMGN's tracked-wallet lists.
 * `configured: false` when GMGN_API_KEY is unset, so the panel can say so
 * plainly instead of rendering an empty feed that looks like "no activity". */
export async function GET() {
  if (!isGmgnConfigured()) {
    return NextResponse.json({ configured: false, trades: [] });
  }
  const trades = await getTrackedTrades();
  return NextResponse.json({ configured: true, trades });
}
