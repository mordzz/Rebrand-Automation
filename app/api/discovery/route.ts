import { NextResponse } from "next/server";

import { isGmgnConfigured } from "@/lib/gmgn/client";
import { discoverRobinhoodTokens } from "@/lib/gmgn/discovery-robinhood";

// Launches appear by the second — never cache.
export const dynamic = "force-dynamic";

const ROW_LIMIT = 30;

/** Fresh Robinhood Chain launches for the dashboard's "New launches"
 * panel (PR16) — the same GMGN `/v1/trenches` adapter the agent's own
 * discovery uses (lib/gmgn/discovery-robinhood.ts), including its
 * launchpad allow-list. Logos come from GMGN itself. `configured: false`
 * when GMGN_API_KEY is unset. Display only — the agent decides on its own
 * safety/strategy/risk pipeline, not on this feed. */
export async function GET() {
  if (!isGmgnConfigured()) {
    return NextResponse.json({ configured: false, tokens: [] });
  }

  const result = await discoverRobinhoodTokens(undefined, 60);
  if (!result.ok) {
    return NextResponse.json({ configured: true, tokens: [], error: result.reason });
  }

  const tokens = result.tokens
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, ROW_LIMIT)
    .map((t) => ({
      tokenAddress: t.tokenAddress,
      chain: t.chain,
      symbol: t.symbol,
      name: t.name,
      logo: t.logo,
      launchpad: t.launchpad,
      createdAt: t.createdAt,
      hasSocialLink: t.hasSocialLink,
      isHoneypot: t.isHoneypot,
      buyTaxPct: t.buyTaxPct,
      sellTaxPct: t.sellTaxPct,
      rugRatio: t.rugRatio,
      top10HolderRate: t.top10HolderRate,
      bundlerRate: t.bundlerRate,
      marketCapUsd: t.marketCapUsd,
      holderCount: t.holderCount,
      smartMoneyCount: t.smartMoneyCount,
      kolCount: t.kolCount,
    }));

  return NextResponse.json({ configured: true, tokens });
}
