/**
 * SOL/USD spot, cached in-process.
 *
 * Needed because positions are denominated in SOL end to end — entry
 * price, exit price and P&L all have to share one unit or every figure
 * downstream is meaningless. Sources that quote a token in USD (GMGN's
 * market cap, for one) therefore have to be converted before they can be
 * compared against DexScreener's SOL-denominated `priceNative`.
 */

const CACHE_TTL_MS = 60_000;
const TIMEOUT_MS = 5000;

let cache: { at: number; usd: number } | null = null;

/** Current SOL price in USD, or null if it cannot be fetched. Callers must
 * treat null as "cannot convert" and skip, never as a default of 1. */
export async function getSolUsdPrice(): Promise<number | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.usd;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: controller.signal }
    );
    if (!res.ok) return cache?.usd ?? null;

    const json = await res.json();
    const usd = Number(json?.solana?.usd);
    if (!Number.isFinite(usd) || usd <= 0) return cache?.usd ?? null;

    cache = { at: Date.now(), usd };
    return usd;
  } catch {
    // Serve a stale rate rather than none: SOL/USD moves far too slowly
    // for a minute of staleness to matter next to losing the conversion.
    return cache?.usd ?? null;
  } finally {
    clearTimeout(timeout);
  }
}
