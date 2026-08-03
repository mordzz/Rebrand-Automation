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

/** Drift publishes its own perp-market icons here — the most directly
 * correct source for a Drift market list, since it's the same artwork
 * Drift's own UI labels these markets with. Each path below was verified
 * to return a real `image/svg+xml` body. WIF is the one market absent
 * from this bucket (403), so it falls back to its verified Jupiter token
 * icon — see WIF's entry. */
const DRIFT_ICONS = "https://drift-public.s3.eu-central-1.amazonaws.com/assets/icons/markets";

export const SUPPORTED_MARKETS: PerpspadMarket[] = [
  { symbol: "SOL", name: "Solana", marketIndex: 0, logoUri: `${DRIFT_ICONS}/sol.svg` },
  { symbol: "BTC", name: "Bitcoin", marketIndex: 1, logoUri: `${DRIFT_ICONS}/btc.svg` },
  { symbol: "ETH", name: "Ethereum", marketIndex: 2, logoUri: `${DRIFT_ICONS}/eth.svg` },
  { symbol: "SUI", name: "Sui", marketIndex: 26, logoUri: `${DRIFT_ICONS}/sui.svg` },
  {
    symbol: "WIF",
    name: "dogwifhat",
    marketIndex: 23,
    // Not in Drift's bucket; this is dogwifhat's own token metadata image,
    // resolved and verified via Jupiter's token API (mint
    // EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm, isVerified: true).
    logoUri:
      "https://bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum.ipfs.nftstorage.link",
  },
  { symbol: "JUP", name: "Jupiter", marketIndex: 24, logoUri: `${DRIFT_ICONS}/jup.svg` },
];

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

/**
 * Pyth Hermes price-feed IDs, one per supported market. Each was
 * confirmed directly against Pyth's own `/v2/price_feeds?query=` search
 * API (not taken from a search-engine summary) by matching the exact
 * `display_symbol` — e.g. "BTC/USD", not a wrapped/staked variant like
 * WBTC or JITOSOL. Drift itself uses Pyth as its oracle, so this is the
 * same price the on-chain markets will ultimately mark against.
 */
const PYTH_FEED_IDS: Record<string, string> = {
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SUI: "23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
  WIF: "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc",
  JUP: "0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996",
};

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
    const [latest, dayAgo] = await Promise.all([
      fetchHermes("/latest", ids),
      fetchHermes(`/${dayAgoUnix}`, ids),
    ]);

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
  } catch {
    // Leave every entry null — an outage at Pyth shouldn't crash the
    // market picker, it should just render "—" until the next poll.
  }

  cache = { at: Date.now(), prices: out };
  return out;
}
