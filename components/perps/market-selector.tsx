"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";

import { TokenIcon } from "@/components/token-icon";
import { formatChange, formatPrice, useMarkets } from "./use-markets";

interface MarketSelectorProps {
  value?: string;
  onChange?: (symbol: string) => void;
  className?: string;
}

export function MarketSelector({
  value,
  onChange,
  className,
}: MarketSelectorProps) {
  const [selected, setSelected] = useState(value ?? "SOL");
  const markets = useMarkets();

  const handleSelect = (symbol: string) => {
    setSelected(symbol);
    onChange?.(symbol);
  };

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="flex items-baseline justify-between">
        <label className="text-xs tracking-wider text-muted-foreground uppercase">
          Underlying Market
        </label>
        <span className="font-mono text-[9px] tracking-wider text-muted-foreground/70 uppercase">
          Live · Pyth
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {markets.map((market) => {
          const isActive = selected === market.symbol;
          const isPositive = (market.change24h ?? 0) >= 0;
          return (
            <button
              key={market.symbol}
              type="button"
              onClick={() => handleSelect(market.symbol)}
              aria-pressed={isActive}
              className={cn(
                "group relative overflow-hidden rounded-xl border p-3 text-left transition-all duration-200",
                isActive
                  ? "border-primary/45 bg-primary/[0.07]"
                  : "border-white/8 bg-white/[0.02] hover:border-white/16 hover:bg-white/[0.04]",
              )}
            >
              <div className="flex items-center gap-2.5">
                <TokenIcon
                  src={market.logoUri}
                  symbol={market.symbol}
                  className={cn(
                    "size-7 transition-transform duration-200",
                    !isActive && "opacity-80 group-hover:opacity-100",
                  )}
                />
                <div className="min-w-0 leading-tight">
                  <p
                    className={cn(
                      "text-xs font-semibold",
                      isActive ? "text-foreground" : "text-foreground/75",
                    )}
                  >
                    {market.symbol}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {market.name}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 flex items-baseline justify-between gap-1">
                <span className="font-mono text-xs tabular-nums text-foreground/90">
                  {formatPrice(market.markPrice)}
                </span>
                <span
                  className={cn(
                    "font-mono text-[10px] tabular-nums",
                    market.change24h == null
                      ? "text-muted-foreground"
                      : isPositive
                        ? "text-[#5ed29c]"
                        : "text-[#e2603f]",
                  )}
                >
                  {formatChange(market.change24h)}
                </span>
              </div>

              {/* Active accent — a hairline along the bottom edge rather
                  than a floating dot, so it reads as "this card is
                  selected" instead of "this card has a notification". */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-0 bottom-0 h-px transition-opacity duration-200",
                  isActive ? "bg-primary/60 opacity-100" : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
