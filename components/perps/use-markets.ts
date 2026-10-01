"use client";

import { useEffect, useState } from "react";

export type Market = {
  symbol: string;
  name: string;
  marketIndex: number;
  logoUri: string | null;
  markPrice: number | null;
  change24h: number | null;
};

type MarketsResponse = { configured: boolean; data: Market[] };

/**
 * The supported Drift markets plus their live Pyth prices.
 *
 * Shared by the ticker and the create-form's market picker so the two
 * can't disagree about what a market costs. The route itself caches for
 * 15s server-side (lib/perps/markets.ts), so polling here collapses into
 * at most one upstream Hermes call per window no matter how many
 * components mount this.
 */
export function useMarkets(intervalMs = 20_000): Market[] {
  const [markets, setMarkets] = useState<Market[]>([]);

  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const res = await fetch("/api/perps/markets");
        const json = (await res.json()) as MarketsResponse;
        if (!disposed && Array.isArray(json.data)) setMarkets(json.data);
      } catch {
        // Keep the last good list - a blip shouldn't blank the UI.
      }
    }
    load();
    const timer = setInterval(load, intervalMs);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return markets;
}

/** Prices here span ~$63,000 (BTC) to ~$0.14 (WIF), so a fixed number of
 * decimals is wrong at one end or the other - sub-$1 markets need real
 * precision, five-figure ones would look absurd with it. */
export function formatPrice(price: number | null): string {
  if (price == null) return "-";
  if (price >= 1000) {
    return `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (price >= 1) {
    return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

export function formatChange(change: number | null): string {
  if (change == null) return "-";
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}
