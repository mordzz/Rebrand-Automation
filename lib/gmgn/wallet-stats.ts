import { gmgnGet, isGmgnConfigured } from "./client";

/**
 * A wallet's own trading record, via GMGN's `/v1/user/wallet_stats` -
 * win rate and realized PnL computed by GMGN across that wallet's full
 * history, not re-derived here from whatever slice of recent trades
 * lib/gmgn/track.ts happened to fetch. Verified live: passing more than
 * one `wallet_address` only ever returns one wallet's data back, so this
 * is a per-wallet call - see getManyWalletStats for the batching.
 */

export type WalletStats = {
  wallet: string;
  /** 0–1, over `period`. Null when GMGN has nothing to compute it from. */
  winRate: number | null;
  /** Realized profit in USD over `period` - closed trades only, same
   * "realized, not a mark-to-market guess" posture as everywhere else
   * PnL shows up on this page. */
  realizedProfitUsd: number | null;
  /** Distinct tokens traded over `period`, GMGN's own count - not the
   * count of positions this page happens to have enriched. */
  tokenCount: number | null;
  followersCount: number | null;
};

type RawWalletStats = {
  realized_profit?: unknown;
  pnl_stat?: { token_num?: unknown; winrate?: unknown } | null;
  common?: { followers_count?: unknown } | null;
};

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalize(wallet: string, raw: RawWalletStats | null): WalletStats {
  return {
    wallet,
    winRate: num(raw?.pnl_stat?.winrate),
    realizedProfitUsd: num(raw?.realized_profit),
    tokenCount: num(raw?.pnl_stat?.token_num),
    followersCount: num(raw?.common?.followers_count),
  };
}

/* Same reasoning as lib/gmgn/token-info.ts's cache: a wallet's 7d record
   barely moves between one poll and the next, so there is no reason to
   re-spend a GMGN call per wallet every cycle - and this is the one
   endpoint here that fans out to one call per KOL on the page (up to
   pageSize of them) rather than one call total, so it's worth caching
   the longest of anything on this page. */
const CACHE_TTL_MS = 180_000;
const cache = new Map<string, { at: number; stats: WalletStats }>();

async function fetchOne(wallet: string, period: string): Promise<WalletStats> {
  const data = await gmgnGet<RawWalletStats>("/v1/user/wallet_stats", {
    chain: "robinhood", // PR16: Robinhood Chain (was "sol")
    wallet_address: wallet,
    period,
  });
  const stats = normalize(wallet, data);
  cache.set(wallet, { at: Date.now(), stats });
  return stats;
}

/** Stats for a set of wallets, cached, one GMGN call per wallet not
 * already fresh. Empty map when GMGN isn't configured. */
export async function getManyWalletStats(
  wallets: string[],
  period = "7d"
): Promise<Map<string, WalletStats>> {
  if (!isGmgnConfigured()) return new Map();

  const unique = [...new Set(wallets)].filter(Boolean);
  const now = Date.now();
  const missing = unique.filter((w) => {
    const cached = cache.get(w);
    return !cached || now - cached.at >= CACHE_TTL_MS;
  });
  await Promise.all(missing.map((w) => fetchOne(w, period)));

  const out = new Map<string, WalletStats>();
  for (const wallet of unique) {
    const cached = cache.get(wallet);
    if (cached) out.set(wallet, cached.stats);
  }
  return out;
}
