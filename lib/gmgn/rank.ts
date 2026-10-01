import { gmgnGet, isGmgnConfigured } from "./client";

/**
 * Market-wide token ranking via GMGN's `/v1/market/rank` - every indexed
 * Robinhood Chain token ranked by a chosen metric (volume, market cap, ...), unlike
 * `/v1/trenches` (discovery.ts) which is scoped to fresh launches only.
 * This is the "what's moving right now" view.
 *
 * The response is double-wrapped - `{ code, data: { code, data: { rank:
 * [...] } } }`, verified directly against the live endpoint - and gmgnGet
 * already strips one `{code,data}` layer, so callers here strip the
 * second explicitly rather than assuming a flat `{ rank }` shape.
 */

export type RankInterval = "1m" | "5m" | "1h" | "6h" | "24h";
export type RankOrderBy = "volume" | "market_cap" | "price_change_percent" | "swaps";

export type RankedToken = {
  mint: string;
  symbol: string | null;
  name: string | null;
  /** GMGN's own logo URL - same 403-to-non-gmgn-origins restriction as
   * discovery.ts#DiscoveredToken.logo. Resolve via components/token-icon.tsx
   * before rendering, never as-is. */
  logo: string | null;
  priceUsd: number | null;
  changePct: number | null;
  marketCapUsd: number | null;
  volumeUsd: number | null;
  launchpad: string | null;
  holderCount: number | null;
  mintAuthorityRenounced: boolean | null;
  freezeAuthorityRenounced: boolean | null;
};

type RawRankToken = Record<string, unknown>;
type RankEnvelope = { data?: { rank?: RawRankToken[] } };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return null;
}

function normalize(raw: RawRankToken): RankedToken | null {
  const mint = str(raw.address);
  if (!mint) return null;

  return {
    mint,
    symbol: str(raw.symbol),
    name: str(raw.name),
    logo: str(raw.logo),
    priceUsd: num(raw.price),
    // `price_change_percent` tracks whatever `interval` was requested with
    // (verified live: requesting interval=1h returned the same value under
    // both `price_change_percent` and `price_change_percent1h`), so this
    // stays correct if the interval below ever changes.
    changePct: num(raw.price_change_percent),
    marketCapUsd: num(raw.market_cap),
    volumeUsd: num(raw.volume),
    launchpad: str(raw.launchpad_platform) ?? str(raw.launchpad),
    holderCount: num(raw.holder_count),
    mintAuthorityRenounced: bool(raw.renounced_mint),
    freezeAuthorityRenounced: bool(raw.renounced_freeze_account),
  };
}

/* The marquee polls this on a fixed cadence from every browser tab that
 * has it open; a shared cache collapses those into one upstream call per
 * window instead of one per tab. Single-slot cache is fine - the route
 * always calls this with the same opts, so there is only ever one cache
 * key in practice. TTL above the marquee's own poll interval, same
 * reasoning as lib/gmgn/track.ts's caches. */
const CACHE_TTL_MS = 40_000;
let cache: { at: number; key: string; tokens: RankedToken[] } | null = null;

/** Top Robinhood Chain tokens by `orderBy` over `interval`, richest first. Empty
 * (never throws) when GMGN isn't configured or the call fails. */
export async function getRankedTokens(opts: {
  interval?: RankInterval;
  orderBy?: RankOrderBy;
  limit?: number;
} = {}): Promise<RankedToken[]> {
  if (!isGmgnConfigured()) return [];

  const { interval = "1h", orderBy = "volume", limit = 20 } = opts;
  const key = `${interval}:${orderBy}:${limit}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.tokens;
  }

  const envelope = await gmgnGet<RankEnvelope>("/v1/market/rank", {
    chain: "robinhood", // PR16: Robinhood Chain (was "sol")
    interval,
    order_by: orderBy,
    direction: "desc",
    limit,
  });
  const list = envelope?.data?.rank;

  const out: RankedToken[] = [];
  if (Array.isArray(list)) {
    for (const raw of list) {
      const token = normalize(raw);
      if (token) out.push(token);
    }
  }
  // Cached even on failure (empty `list`) - a rate-limit ban should back
  // off for a full cache window, not get retried by every poll from
  // every open tab, which is what extended the ban this comment refers
  // to in the first place.
  cache = { at: Date.now(), key, tokens: out };
  return out;
}
