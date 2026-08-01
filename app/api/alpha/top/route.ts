import { NextResponse } from "next/server";

import { isGmgnConfigured } from "@/lib/gmgn/client";
import { getRankedTokens } from "@/lib/gmgn/rank";
import { getTokenIcons } from "@/lib/jupiter/token-icons";

// Ranks reshuffle by the second — never cache.
export const dynamic = "force-dynamic";

const ROW_LIMIT = 20;

/** Market-wide "what's moving" feed for the marquee above the Alpha
 * table — every indexed Solana token ranked by 1h volume, not scoped to
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
  const icons = await getTokenIcons(ranked.map((t) => t.mint));

  const tokens = ranked.map((t) => ({
    ...t,
    logo: icons.get(t.mint) ?? null,
  }));

  return NextResponse.json({ configured: true, tokens });
}
