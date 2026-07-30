import { gmgnGet, isGmgnConfigured } from "./client";

/**
 * Live KOL and smart-money trade activity from GMGN's tracked-wallet
 * lists. This is the piece the Alpha page could not answer on its own:
 * our own pipeline sees mints and on-chain safety, but has no notion of
 * *who* is buying. GMGN resolves tracked wallets to public identities, so
 * no X/Twitter API is involved on our side.
 *
 * The two lists mean different things and are never merged blindly:
 *   - `kol`         — wallets tagged as public influencers. Social signal,
 *                     not necessarily profitable.
 *   - `smartmoney`  — wallets with a measured profitable record. The
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
  timestamp?: unknown;
  base_address?: unknown;
  base_token?: { symbol?: unknown; logo?: unknown } | null;
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
       rows here — a multi-hop swap reports each leg separately, so the
       hash alone is not unique and collided in practice. */
    id: `${source}:${index}:${str(raw.transaction_hash) ?? `${wallet}:${timestamp}`}`,
    source,
    side: raw.side === "sell" ? "sell" : "buy",
    token,
    symbol: str(raw.base_token?.symbol),
    tokenLogo: str(raw.base_token?.logo),
    amountUsd: num(raw.amount_usd),
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
  const data = await gmgnGet<{ list?: RawTrade[] }>(path, { chain: "sol", limit });
  const list = data?.list;
  if (!Array.isArray(list)) return [];
  return list
    .map((raw, index) => normalize(raw, source, index))
    .filter((t): t is TrackedTrade => t !== null);
}

/* The upstream feed is real-time and the panel polls it; a short shared
   cache keeps repeated page loads from spending one upstream call each,
   without making the feed meaningfully stale. */
const CACHE_TTL_MS = 15_000;
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
