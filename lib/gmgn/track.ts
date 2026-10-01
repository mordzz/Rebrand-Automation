import { gmgnGet, isGmgnConfigured } from "./client";

/**
 * Live KOL and smart-money trade activity from GMGN's tracked-wallet
 * lists. This is the piece the Alpha page could not answer on its own:
 * our own pipeline sees mints and on-chain safety, but has no notion of
 * *who* is buying. GMGN resolves tracked wallets to public identities, so
 * no X/Twitter API is involved on our side.
 *
 * The two lists mean different things and are never merged blindly:
 *   - `kol`         - wallets tagged as public influencers. Social signal,
 *                     not necessarily profitable.
 *   - `smartmoney`  - wallets with a measured profitable record. The
 *                     stronger signal of the two, per GMGN's own docs.
 */

export type TrackSource = "kol" | "smart";

export type TrackedTrade = {
  id: string;
  source: TrackSource;
  side: "buy" | "sell";
  /** Mint of the token traded (the `base_address` side of the pair). */
  token: string;
  symbol: string | null;
  tokenLogo: string | null;
  amountUsd: number | null;
  /** USD price per token at trade time - combined with `totalSupply`,
   * gives the market cap at exactly this trade rather than whatever it is
   * now. Null when GMGN didn't report it. */
  priceUsd: number | null;
  /** What was originally paid for the position this sell closes out,
   * GMGN's own cost basis (only meaningful on `side: "sell"`). This is
   * what makes realized PnL derivable without re-deriving it from
   * matching buy trades ourselves - see lib/gmgn/kol-positions.ts. */
  buyCostUsd: number | null;
  totalSupply: number | null;
  timestamp: number;
  wallet: string;
  /** Display name for the wallet: GMGN name, else X handle, else short address. */
  traderName: string;
  traderHandle: string | null;
  traderAvatar: string | null;
};

type RawTrade = {
  transaction_hash?: unknown;
  maker?: unknown;
  side?: unknown;
  amount_usd?: unknown;
  buy_cost_usd?: unknown;
  price_usd?: unknown;
  timestamp?: unknown;
  base_address?: unknown;
  base_token?: { symbol?: unknown; logo?: unknown; total_supply?: unknown } | null;
  maker_info?: {
    name?: unknown;
    twitter_username?: unknown;
    avatar?: unknown;
  } | null;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function shortAddress(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function normalize(
  raw: RawTrade,
  source: TrackSource,
  index: number
): TrackedTrade | null {
  const token = str(raw.base_address);
  const wallet = str(raw.maker);
  const timestamp = num(raw.timestamp);
  if (!token || !wallet || timestamp == null) return null;

  const handle = str(raw.maker_info?.twitter_username);
  const name = str(raw.maker_info?.name);

  return {
    /* Namespaced by source (a wallet can appear in both lists) and by
       position, because one transaction hash legitimately covers several
       rows here - a multi-hop swap reports each leg separately, so the
       hash alone is not unique and collided in practice. */
    id: `${source}:${index}:${str(raw.transaction_hash) ?? `${wallet}:${timestamp}`}`,
    source,
    side: raw.side === "sell" ? "sell" : "buy",
    token,
    symbol: str(raw.base_token?.symbol),
    tokenLogo: str(raw.base_token?.logo),
    amountUsd: num(raw.amount_usd),
    priceUsd: num(raw.price_usd),
    // GMGN sends this as 0 on buys (not applicable), not absent - but 0
    // is also indistinguishable from "a sell that reports no cost basis",
    // so it's kept as a plain number rather than nulled out here; callers
    // pairing buys/sells only ever read it off a sell record anyway.
    buyCostUsd: num(raw.buy_cost_usd),
    totalSupply: num(raw.base_token?.total_supply),
    timestamp,
    wallet,
    traderName: name ?? handle ?? shortAddress(wallet),
    traderHandle: handle,
    traderAvatar: str(raw.maker_info?.avatar),
  };
}

async function fetchList(
  path: string,
  source: TrackSource,
  limit: number
): Promise<TrackedTrade[]> {
  const data = await gmgnGet<{ list?: RawTrade[] }>(path, { chain: "robinhood", limit });
  const list = data?.list;
  if (!Array.isArray(list)) return [];
  return list
    .map((raw, index) => normalize(raw, source, index))
    .filter((t): t is TrackedTrade => t !== null);
}

/* The upstream feed is real-time and several panels poll it independently
 * (smart-money-panel.tsx, alpha-table.tsx's tracked-wallet column) - a
 * shared server-side cache means N browser tabs' polls collapse into one
 * upstream call per window, not N. TTL set above every caller's own poll
 * interval on purpose: equal to it would still race-miss on the tick the
 * poll and the cache expiry land close together, spending an upstream
 * call anyway. GMGN's own rate limiter has a real, sticky ban behind it
 * (verified live: a burst of calls earlier got this key temporarily
 * blocked project-wide, not just throttled) - err generous here. */
const CACHE_TTL_MS = 30_000;
let cache: { at: number; trades: TrackedTrade[] } | null = null;

export async function getTrackedTrades(limit = 30): Promise<TrackedTrade[]> {
  if (!isGmgnConfigured()) return [];
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.trades;

  const [kol, smart] = await Promise.all([
    fetchList("/v1/user/kol", "kol", limit),
    fetchList("/v1/user/smartmoney", "smart", limit),
  ]);

  const trades = [...kol, ...smart].sort((a, b) => b.timestamp - a.timestamp);
  cache = { at: Date.now(), trades };
  return trades;
}

/** KOL trades only, at the endpoint's own cap (verified live: `limit`
 * stops mattering past 100, so asking for more is pointless) rather than
 * the combined feed's smaller page-sized default - enough per-wallet
 * history to tell "still holding" from "already sold" (see
 * lib/gmgn/kol-positions.ts). Deliberately its own fetch rather than
 * reusing getTrackedTrades: that call's limit is tuned for a chronological
 * feed's page size, not for having enough rows per individual KOL.
 *
 * Own cache too, same reasoning as getTrackedTrades' above (shared across
 * every browser tab's poll, TTL above the KOL leaderboard's own poll
 * interval) - this one used to have none at all, which made it the
 * single heaviest contributor to the rate-limit ban this comment now
 * warns about. */
const KOL_CACHE_TTL_MS = 40_000;
let kolCache: { at: number; trades: TrackedTrade[] } | null = null;

export async function getKolTrades(limit = 100): Promise<TrackedTrade[]> {
  if (!isGmgnConfigured()) return [];
  if (kolCache && Date.now() - kolCache.at < KOL_CACHE_TTL_MS) return kolCache.trades;

  const trades = await fetchList("/v1/user/kol", "kol", limit);
  kolCache = { at: Date.now(), trades };
  return trades;
}

/** Mints currently being traded by tracked wallets, for cross-referencing
 * against our own candidate list. Buys and sells are kept apart: a KOL
 * *selling* a token is the opposite signal from one buying it, and
 * collapsing them would turn an exit into a false endorsement. */
export async function getTrackedTokenIndex(): Promise<
  Map<string, { buys: TrackedTrade[]; sells: TrackedTrade[] }>
> {
  const trades = await getTrackedTrades();
  const index = new Map<string, { buys: TrackedTrade[]; sells: TrackedTrade[] }>();
  for (const trade of trades) {
    let entry = index.get(trade.token);
    if (!entry) {
      entry = { buys: [], sells: [] };
      index.set(trade.token, entry);
    }
    (trade.side === "buy" ? entry.buys : entry.sells).push(trade);
  }
  return index;
}
