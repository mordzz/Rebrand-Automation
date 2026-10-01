"use client";

import { cn } from "@/lib/utils";

import { TokenIcon } from "@/components/token-icon";
import { formatChange, formatPrice, useMarkets } from "./use-markets";

/**
 * Live price strip for every market Perpspad can back a token with.
 *
 * Sits above the tab content, so whichever tab is open the page always
 * shows something real and moving - these are genuine Pyth oracle prices
 * (see lib/perps/markets.ts), the same feed Drift's own perp markets
 * mark against, not decoration.
 */
export function MarketTicker() {
  const markets = useMarkets();

  return (
    <div className="border-y border-white/6 bg-white/[0.015]">
      <div className="flex items-stretch gap-px overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex shrink-0 items-center gap-2 border-r border-white/6 px-4 py-3">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#5ed29c] opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-[#5ed29c]" />
          </span>
          <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
            Oracle
          </span>
        </div>

        {markets.length === 0
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex shrink-0 items-center gap-2.5 px-4 py-3"
              >
                <div className="size-6 animate-pulse rounded-full bg-white/6" />
                <div className="space-y-1">
                  <div className="h-2 w-8 animate-pulse rounded bg-white/6" />
                  <div className="h-2 w-12 animate-pulse rounded bg-white/[0.04]" />
                </div>
              </div>
            ))
          : markets.map((m) => {
              const up = (m.change24h ?? 0) >= 0;
              return (
                <div
                  key={`${m.symbol}-${m.marketIndex}`}
                  className="group flex shrink-0 items-center gap-2.5 px-4 py-3 transition-colors hover:bg-white/[0.025]"
                >
                  <TokenIcon
                    src={m.logoUri}
                    symbol={m.symbol}
                    className="size-6"
                  />
                  <div className="leading-tight">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-foreground/80">
                        {m.symbol}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-[9px] tabular-nums",
                          m.change24h == null
                            ? "text-muted-foreground"
                            : up
                              ? "text-[#5ed29c]"
                              : "text-[#e2603f]",
                        )}
                      >
                        {formatChange(m.change24h)}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-foreground">
                      {formatPrice(m.markPrice)}
                    </span>
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
}
