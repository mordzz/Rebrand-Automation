import { NextResponse } from "next/server";

import { isGmgnConfigured } from "@/lib/gmgn/client";
import { discoverTokens } from "@/lib/gmgn/discovery";
import { getTokenIcons } from "@/lib/jupiter/token-icons";

// Fresh launches change every few seconds — never cache.
export const dynamic = "force-dynamic";

const ROW_LIMIT = 40;

/** Multi-launchpad new-token feed (GMGN `/v1/trenches`), covering every
 * Solana launchpad rather than just pump.fun. `configured: false` when
 * GMGN_API_KEY is unset so the panel can say so instead of looking empty.
 *
 * Icons are resolved through Jupiter rather than used as GMGN returns
 * them: GMGN's own image host answers 403 to anything that isn't gmgn.ai,
 * so those URLs render as broken images in our pages. See
 * lib/jupiter/token-icons.ts. */
export async function GET() {
  if (!isGmgnConfigured()) {
    return NextResponse.json({ configured: false, tokens: [] });
  }

  const discovered = (await discoverTokens(["new_creation"], 60)).slice(0, ROW_LIMIT);
  const icons = await getTokenIcons(discovered.map((t) => t.mint));

  const tokens = discovered.map((token) => ({
    ...token,
    logo: icons.get(token.mint) ?? null,
  }));

  return NextResponse.json({ configured: true, tokens });
}
