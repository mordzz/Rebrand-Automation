/**
 * Current price of a token in SOL terms, via DexScreener's free public API
 * (no key required) - chosen over PumpPortal's own trade stream because
 * that requires a separately-funded (0.02 SOL minimum) PumpPortal-linked
 * wallet once its usage is metered. Response shape confirmed via a live
 * curl against a real pump.fun-launched mint, not assumed.
 */
const PRICE_TIMEOUT_MS = 4000;

export async function getCurrentPrice(mint: string): Promise<number | null> {
  /* Bounded, like every other outbound call in the daemon's scheduled
     loops. Without it a hung connection here never settles, and because
     the exit loop awaits this before rescheduling itself, one stalled
     request stops every exit check for every position permanently - no
     error, no log, just silence and open positions nobody is watching. */
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRICE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      { signal: controller.signal }
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
    // Reject non-positive as well as non-numeric. DexScreener returns a
    // literal 0 for pairs it has indexed but not yet priced (common for
    // mints seconds old), and 0 is finite - so a bare isFinite check let
    // it through as a real quote. Downstream that reads as a -100% move,
    // trips the stop-loss, and books a total loss that never happened.
    // No live pool has a true price of zero, so zero means "no data".
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
