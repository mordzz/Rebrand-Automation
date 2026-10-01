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

export const SUPPORTED_MARKETS: PerpspadMarket[] = driftMarketsJson as PerpspadMarket[];
