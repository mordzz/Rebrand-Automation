/**
 * Curated list of Drift perp markets Perpspad supports at launch.
 *
 * The symbol/name/marketIndex mapping is legitimately static reference
 * data — Drift's own SDK ships its market list the same way, it isn't
 * something to query per-request. **`marketIndex` values below are best-
 * effort, not verified against Drift's live devnet market config** — per
 * the Perpspad plan, Phase 2 must re-confirm every one of these against
 * Drift's actual devnet `DevnetPerpMarkets` list before any CPI code
 * trusts them; a wrong index there sends collateral into the wrong
 * market, not a cosmetic bug.
 *
 * `markPrice`/`change24h` are NOT hardcoded here — this file previously
 * (as MOCK_MARKETS) shipped fabricated static prices, which this repo's
 * own convention treats as a defect (Design Principle 8 / the "no
 * invented evidence" rule already applied elsewhere on this site).
 * getMarketPrices() below fetches real live prices from Pyth's Hermes
 * API (the same oracle Drift itself uses) and falls back to null — never
 * a guessed number — if that fetch fails.
 */

export type PerpspadMarket = {
  symbol: string;
  name: string;
  /** Drift's own numeric market index — see the file-level caveat above. */
  marketIndex: number;
  logoUri: string | null;
};

import driftMarketsJson from "@/lib/perps/generated/drift-markets.json";

/** Logo for a market symbol, or null if it isn't one we support. Used by
 * views that only carry a symbol string (launched-token cards) rather
 * than a whole market record. */
export function getMarketLogo(symbol: string): string | null {
  return SUPPORTED_MARKETS.find((m) => m.symbol === symbol)?.logoUri ?? null;
}

export function getMarketBySymbol(symbol: string): PerpspadMarket | null {
  return SUPPORTED_MARKETS.find((m) => m.symbol === symbol) ?? null;
}

export type MarketPrice = {
  markPrice: number | null;
  change24h: number | null;
};

const PYTH_FEED_IDS: Record<string, string> = {};
for (const m of driftMarketsJson) {
  if (m.pythFeedId) {
    PYTH_FEED_IDS[m.symbol] = m.pythFeedId;
  }
}

export const SUPPORTED_MARKETS: PerpspadMarket[] = driftMarketsJson as PerpspadMarket[];

const HERMES_BASE = "https://hermes.pyth.network/v2/updates/price";

type HermesParsedPrice = {
  id: string;
  price: { price: string; expo: number; publish_time: number };
};
type HermesResponse = { parsed?: HermesParsedPrice[] };

function toNumber(p: HermesParsedPrice["price"]): number {
  return Number(p.price) * 10 ** p.expo;
}

async function fetchHermes(
  path: string,
  ids: string[],
): Promise<Map<string, number>> {
  const params = ids.map((id) => `ids[]=${id}`).join("&");
  const res = await fetch(`${HERMES_BASE}${path}?${params}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Hermes ${res.status}`);
  const json = (await res.json()) as HermesResponse;
  const out = new Map<string, number>();
  for (const entry of json.parsed ?? []) {
    out.set(entry.id, toNumber(entry.price));
  }
  return out;
}

/* Single-slot cache, same shape as lib/gmgn/rank.ts's — this is always
 * called with the same fixed symbol set, so there is only ever one cache
 * key in practice. TTL is short since these are live market prices, but
 * still collapses concurrent page loads into one upstream Hermes call. */
const CACHE_TTL_MS = 15_000;
let cache: { at: number; prices: Map<string, MarketPrice> } | null = null;

/** Live mark price + 24h change per supported market, sourced from
 * Pyth's Hermes API — the same oracle Drift's own perp markets mark
 * against. Latest price comes from `/v2/updates/price/latest`; 24h
 * change is derived by also fetching the price as of ~24h ago via
 * Hermes' historical `/v2/updates/price/{unix_timestamp}` endpoint and
 * comparing. On any fetch failure this falls back to nulls (rendered as
 * "—" by the UI) rather than fabricating a number. */
export async function getMarketPrices(): Promise<Map<string, MarketPrice>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.prices;

  const out = new Map<string, MarketPrice>();
  for (const market of SUPPORTED_MARKETS) {
    out.set(market.symbol, { markPrice: null, change24h: null });
  }

  const ids = Object.values(PYTH_FEED_IDS);
  const dayAgoUnix = Math.floor(Date.now() / 1000) - 86_400;

  try {
    const latest = await fetchHermes("/latest", ids);
    const dayAgo = new Map<string, number>();

    const chunkSize = 10;
    const historicalPromises: Promise<Map<string, number>>[] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      historicalPromises.push(fetchHermes(`/${dayAgoUnix}`, chunk));
    }

    const historicalResults = await Promise.allSettled(historicalPromises);
    for (const result of historicalResults) {
      if (result.status === "fulfilled") {
        for (const [id, price] of result.value.entries()) {
          dayAgo.set(id, price);
        }
      }
    }

    for (const market of SUPPORTED_MARKETS) {
      const feedId = PYTH_FEED_IDS[market.symbol];
      const markPrice = feedId ? (latest.get(feedId) ?? null) : null;
      const oldPrice = feedId ? (dayAgo.get(feedId) ?? null) : null;
      const change24h =
        markPrice != null && oldPrice != null && oldPrice !== 0
          ? ((markPrice - oldPrice) / oldPrice) * 100
          : null;
      out.set(market.symbol, { markPrice, change24h });
    }
  } catch (err) {
    console.warn("Failed to fetch Pyth latest market prices:", err);
  }

  cache = { at: Date.now(), prices: out };
  return out;
}
