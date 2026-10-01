/**
 * Live market data for a set of mints, via DexScreener's free public API
 * (no key required) - the same source lib/sniper/exit-price.ts already
 * uses for exit pricing, queried in batch here because the Alpha page
 * needs a figure for every row at once.
 *
 * Response shape confirmed against live pump.fun mints, not assumed:
 * each pair carries `marketCap`, `fdv`, `priceUsd`, `priceNative`,
 * `volume` and `priceChange`.
 */

export type ChangeWindow = "5m" | "1h" | "6h" | "24h";

export type TokenMarket = {
  marketCapUsd: number | null;
  priceUsd: number | null;
  /** Percent move over `changeWindow`. Both null when nothing is reported. */
  changePct: number | null;
  /** Which window `changePct` covers. A mint minutes old usually has only
   * the 24h bucket populated, so the window is surfaced rather than
   * assumed - labelling a since-launch move as "5m" would be a lie. */
  changeWindow: ChangeWindow | null;
  volumeH24Usd: number | null;
};

/** Shortest first: the tightest window with a real number wins. */
const CHANGE_WINDOWS: { key: string; label: ChangeWindow }[] = [
  { key: "m5", label: "5m" },
  { key: "h1", label: "1h" },
  { key: "h6", label: "6h" },
  { key: "h24", label: "24h" },
];

/** DexScreener caps the batch token endpoint at 30 addresses per call. */
const BATCH_SIZE = 30;

function pickPair(pairs: unknown[]): Record<string, unknown> | null {
  // Prefer a SOL-quoted pair (pump.fun bonding-curve and migrated pairs are
  // quoted in SOL); fall back to the first pair otherwise.
  const sol = pairs.find(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      (p as { quoteToken?: { symbol?: string } }).quoteToken?.symbol === "SOL"
  );
  const chosen = sol ?? pairs[0];
  return typeof chosen === "object" && chosen !== null
    ? (chosen as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchBatch(mints: string[]): Promise<Map<string, TokenMarket>> {
  const out = new Map<string, TokenMarket>();
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mints.join(",")}`
    );
    if (!res.ok) return out;

    const json = await res.json();
    const pairs = json?.pairs;
    if (!Array.isArray(pairs)) return out;

    // One mint can come back as several pairs; group first, then pick.
    const byMint = new Map<string, unknown[]>();
    for (const pair of pairs) {
      const addr = (pair as { baseToken?: { address?: string } })?.baseToken?.address;
      if (typeof addr !== "string") continue;
      const list = byMint.get(addr);
      if (list) list.push(pair);
      else byMint.set(addr, [pair]);
    }

    for (const [mint, list] of byMint) {
      const pair = pickPair(list);
      if (!pair) continue;

      const priceChange = (pair.priceChange ?? {}) as Record<string, unknown>;
      let changePct: number | null = null;
      let changeWindow: ChangeWindow | null = null;
      for (const { key, label } of CHANGE_WINDOWS) {
        const value = num(priceChange[key]);
        if (value != null) {
          changePct = value;
          changeWindow = label;
          break;
        }
      }

      out.set(mint, {
        marketCapUsd: num(pair.marketCap) ?? num(pair.fdv),
        priceUsd: num(pair.priceUsd),
        changePct,
        changeWindow,
        volumeH24Usd: num((pair.volume as { h24?: unknown } | undefined)?.h24),
      });
    }
  } catch {
    // Network/API trouble is not fatal - callers render the row without a
    // market figure rather than dropping it.
  }
  return out;
}

/**
 * Live market data keyed by mint. Mints with no DexScreener pair yet (a
 * brand-new mint still on its bonding curve often has none) are simply
 * absent from the map - callers should treat "missing" as "not priced
 * yet", never as zero.
 */
export async function getTokenMarkets(
  mints: string[]
): Promise<Map<string, TokenMarket>> {
  const unique = [...new Set(mints)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    batches.push(unique.slice(i, i + BATCH_SIZE));
  }

  const results = await Promise.all(batches.map(fetchBatch));
  const merged = new Map<string, TokenMarket>();
  for (const batch of results) {
    for (const [mint, market] of batch) merged.set(mint, market);
  }
  return merged;
}
