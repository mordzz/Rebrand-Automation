"use client";

import { useEffect, useState } from "react";

import { TokenIcon } from "@/components/token-icon";
import { cn } from "@/lib/utils";

type TopToken = {
  mint: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  priceUsd: number | null;
  changePct: number | null;
  marketCapUsd: number | null;
  volumeUsd: number | null;
  launchpad: string | null;
  holderCount: number | null;
  mintAuthorityRenounced: boolean | null;
  freezeAuthorityRenounced: boolean | null;
};

type TopTokensResponse = { configured: boolean; tokens: TopToken[] };

function usePolledJson<T>(url: string, intervalMs: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const res = await fetch(url);
        const json = (await res.json()) as T;
        if (!disposed) setData(json);
      } catch {
        // keep whatever we already have
      }
    }
    load();
    const interval = setInterval(load, intervalMs);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [url, intervalMs]);
  return data;
}

function Pill({ token }: { token: TopToken }) {
  const change = token.changePct;
  return (
    <a
      href={`https://dexscreener.com/solana/${token.mint}`}
      target="_blank"
      rel="noreferrer"
      className="flex shrink-0 items-center gap-2 border-r border-white/5 px-4 py-3 text-xs transition-colors hover:bg-white/[0.02]"
    >
      <TokenIcon src={token.logo} symbol={token.symbol} className="size-5" />
      <span className="font-medium">${token.symbol ?? "?"}</span>
      <span
        className={cn(
          "tabular-nums",
          change == null && "text-muted-foreground",
          change != null && change > 0 && "text-sol-green-ink",
          change != null && change < 0 && "text-destructive"
        )}
      >
        {change != null ? `${change > 0 ? "+" : ""}${change.toFixed(1)}%` : "—"}
      </span>
    </a>
  );
}

/** Market-wide "what's moving" strip above the Alpha table. Deliberately
 * separate from the table's own vetted candidates: nothing here has
 * necessarily passed the Raven's entry checks, it's just what the whole
 * chain is trading right now — so it renders nothing rather than a
 * disabled state when the feed isn't available, same call as dropping
 * the permanently-empty Robinhood Chain panel. */
export function TopTokensMarquee() {
  const response = usePolledJson<TopTokensResponse>("/api/alpha/top", 30_000);

  if (!response?.configured || response.tokens.length === 0) return null;

  const tape = [...response.tokens, ...response.tokens];

  return (
    <div className="flex items-stretch overflow-hidden rounded-2xl bg-card">
      <div className="flex shrink-0 items-center border-r border-white/5 px-4">
        <p className="text-[0.65rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
          Trending
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="flex w-max animate-marquee hover:[animation-play-state:paused]">
          {tape.map((token, i) => (
            <Pill key={`${token.mint}-${i}`} token={token} />
          ))}
        </div>
      </div>
    </div>
  );
}
