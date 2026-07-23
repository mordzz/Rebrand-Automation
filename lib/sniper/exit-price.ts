/**
 * Current price of a token in SOL terms, via DexScreener's free public API
 * (no key required) — chosen over PumpPortal's own trade stream because
 * that requires a separately-funded (0.02 SOL minimum) PumpPortal-linked
 * wallet once its usage is metered. Response shape confirmed via a live
 * curl against a real pump.fun-launched mint, not assumed.
 */
export async function getCurrentPrice(mint: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`
    );
    if (!res.ok) return null;

    const json = await res.json();
    const pairs = json?.pairs;
    if (!Array.isArray(pairs) || pairs.length === 0) return null;

    // Prefer a SOL-quoted pair (pump.fun bonding-curve / migrated pairs are
    // quoted in SOL); fall back to the first pair otherwise.
    const pair =
      pairs.find(
        (p: unknown) =>
          typeof p === "object" &&
          p !== null &&
          (p as { quoteToken?: { symbol?: string } }).quoteToken?.symbol ===
            "SOL"
      ) ?? pairs[0];

    const price = Number(pair?.priceNative);
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}
