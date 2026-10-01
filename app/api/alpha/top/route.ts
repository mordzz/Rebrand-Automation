import { NextResponse } from "next/server";

import { isGmgnConfigured } from "@/lib/gmgn/client";
import { getRankedTokens } from "@/lib/gmgn/rank";

// Ranks reshuffle by the second — never cache.
export const dynamic = "force-dynamic";

const ROW_LIMIT = 20;

/** Market-wide "what's moving" feed for the marquee above the Alpha
 * table — every indexed Robinhood Chain token ranked by 1h volume, not scoped to
 * what passed our own entry criteria the way the table below it is.
 * `configured: false` when GMGN_API_KEY is unset, so the marquee can
 * simply not render rather than show a broken strip. */
export async function GET() {
  if (!isGmgnConfigured()) {
    return NextResponse.json({ configured: false, tokens: [] });
  }

  const ranked = await getRankedTokens({
    interval: "1h",
    orderBy: "volume",
    limit: ROW_LIMIT,
  });
  // GMGN's own logo; TokenIcon falls back to a monogram if it won't load
  // (Jupiter's icon index is Solana-only).
  const tokens = ranked;

  return NextResponse.json({ configured: true, tokens });
}
