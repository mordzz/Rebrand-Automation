import { gmgnGet, isGmgnConfigured } from "./client";

/**
 * A wallet's real, current on-chain balance of one token, via GMGN's
 * `/v1/user/wallet_token_balance` — verified live against a known KOL
 * wallet + mint pair. Separate from anything in lib/gmgn/kol-positions.ts:
 * that module only knows what the trade window it saw implies about a
 * position; this is the actual balance right now, which also catches a
 * partial exit a "closed" cycle's own trade pairing wouldn't otherwise
 * reveal (a sell closes a cycle here even if it only sold part of the
 * bag).
 */

export type WalletTokenBalance = {
  wallet: string;
  mint: string;
  /** Already decimal-adjusted (verified live: matches the same
   * human-readable scale as trade payloads' own token_amount/base_amount,
   * not raw base units), or null when GMGN has nothing for this pair. */
  balance: number | null;
};

type RawBalanceEntry = { balance?: unknown };
type RawResponse = { balances?: RawBalanceEntry[] };

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cacheKey(wallet: string, mint: string): string {
  return `${wallet}:${mint}`;
}

/* A holding doesn't move on every 20-30s poll the way a trade feed does
   — cached generously, same posture as lib/gmgn/wallet-stats.ts, and for
   the same reason: this is a per-row fan-out call (one per position on
   the page), the exact shape of call volume that tripped GMGN's rate
   limiter before every GMGN call here had a cache. */
const CACHE_TTL_MS = 90_000;
const cache = new Map<string, { at: number; balance: WalletTokenBalance }>();

async function fetchOne(wallet: string, mint: string): Promise<WalletTokenBalance> {
  const data = await gmgnGet<RawResponse>("/v1/user/wallet_token_balance", {
    chain: "robinhood", // PR16: Robinhood Chain (was "sol")
    wallet_address: wallet,
    token_address: mint,
  });
  const balance: WalletTokenBalance = {
    wallet,
    mint,
    balance: num(data?.balances?.[0]?.balance),
  };
  cache.set(cacheKey(wallet, mint), { at: Date.now(), balance });
  return balance;
}

/** Balances for a set of (wallet, mint) pairs, cached, one GMGN call per
 * pair not already fresh. Empty map when GMGN isn't configured. */
export async function getManyWalletTokenBalances(
  pairs: { wallet: string; mint: string }[]
): Promise<Map<string, WalletTokenBalance>> {
  if (!isGmgnConfigured()) return new Map();

  const unique = new Map<string, { wallet: string; mint: string }>();
  for (const p of pairs) unique.set(cacheKey(p.wallet, p.mint), p);

  const now = Date.now();
  const missing = [...unique.values()].filter((p) => {
    const cached = cache.get(cacheKey(p.wallet, p.mint));
    return !cached || now - cached.at >= CACHE_TTL_MS;
  });
  await Promise.all(missing.map((p) => fetchOne(p.wallet, p.mint)));

  const out = new Map<string, WalletTokenBalance>();
  for (const key of unique.keys()) {
    const cached = cache.get(key);
    if (cached) out.set(key, cached.balance);
  }
  return out;
}
