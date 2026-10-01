import { gmgnGet, isGmgnConfigured } from "./client";

/**
 * A single token's own social links, via GMGN's `/v1/token/info`.
 *
 * Separate from lib/gmgn/discovery.ts and lib/gmgn/track.ts: those cover
 * fresh launches and trade activity, neither of which carries a token's
 * website/telegram/X — that only comes back from this per-mint lookup.
 * Verified directly against the live endpoint (not assumed from docs):
 * fields live under `data.link`.
 */

export type TokenSocials = {
  mint: string;
  twitter: string | null;
  website: string | null;
  telegram: string | null;
};

type RawTokenInfo = {
  link?: {
    twitter_username?: unknown;
    website?: unknown;
    telegram?: unknown;
  } | null;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/* A token's socials rarely change once set — worth remembering across the
   short poll windows the KOL table refreshes on, so a page of results
   already seen doesn't re-spend a GMGN call per mint every cycle. Negative
   results are cached too, same reasoning as lib/jupiter/token-icons.ts. */
const MAX_CACHE_ENTRIES = 2000;
const cache = new Map<string, TokenSocials>();

function remember(socials: TokenSocials): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest != null) cache.delete(oldest);
  }
  cache.set(socials.mint, socials);
}

async function fetchOne(mint: string): Promise<TokenSocials> {
  const data = await gmgnGet<RawTokenInfo>("/v1/token/info", {
    chain: "robinhood", // PR16: Robinhood Chain (was "sol")
    address: mint,
  });
  const socials: TokenSocials = {
    mint,
    twitter: str(data?.link?.twitter_username),
    website: str(data?.link?.website),
    telegram: str(data?.link?.telegram),
  };
  remember(socials);
  return socials;
}

/** Socials for a set of mints, cached, one GMGN call per mint not already
 * known. Empty map when GMGN isn't configured. */
export async function getTokenSocials(
  mints: string[]
): Promise<Map<string, TokenSocials>> {
  if (!isGmgnConfigured()) return new Map();

  const unique = [...new Set(mints)].filter(Boolean);
  const missing = unique.filter((m) => !cache.has(m));
  await Promise.all(missing.map(fetchOne));

  const out = new Map<string, TokenSocials>();
  for (const mint of unique) {
    const socials = cache.get(mint);
    if (socials) out.set(mint, socials);
  }
  return out;
}
