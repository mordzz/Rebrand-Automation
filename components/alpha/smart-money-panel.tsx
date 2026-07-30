"use client";

import { ArrowDownRight, ArrowUpRight, ExternalLink, Lock, Radar } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type TrackedTrade = {
  id: string;
  source: "kol" | "smart";
  side: "buy" | "sell";
  token: string;
  symbol: string | null;
  tokenLogo: string | null;
  amountUsd: number | null;
  timestamp: number;
  wallet: string;
  traderName: string;
  traderHandle: string | null;
  traderAvatar: string | null;
};

type TrackResponse = { configured: boolean; trades: TrackedTrade[] };

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

function timeAgo(unixSec: number, now: number): string {
  const s = Math.max(0, Math.round(now / 1000 - unixSec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "smart", label: "Smart money" },
  { id: "kol", label: "KOL" },
] as const;

/** Live view of who is actually buying and selling, from GMGN's tracked
 * wallet lists. Our own pipeline can prove a token is structurally safe
 * but has no notion of who is in it; this is that missing half. Reads
 * public wallet labels, so no X/Twitter API is involved. */
export function SmartMoneyPanel() {
  const response = usePolledJson<TrackResponse>("/api/alpha/track", 15_000);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, []);

  const trades = (response?.trades ?? []).filter((t) =>
    filter === "all" ? true : t.source === filter
  );

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Radar className="size-4" />
          </span>
          <div>
            <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
              Smart money &amp; KOL
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Who is actually buying, from GMGN&apos;s tracked wallets.
            </p>
          </div>
        </div>

        {response?.configured && (
          <div className="flex items-center gap-1 rounded-full bg-secondary p-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
                  filter === f.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {response && !response.configured ? (
        <div className="border-t border-white/5 px-4 py-8 text-center">
          <p className="mx-auto flex max-w-md items-center justify-center gap-2 text-xs font-medium tracking-[0.15em] uppercase text-muted-foreground">
            <Lock className="size-3.5" />
            Not connected
          </p>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
            Tracked-wallet activity needs a GMGN API key. Generate an Ed25519
            key pair, submit the public key at{" "}
            <a
              href="https://gmgn.ai/ai"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline-offset-2 hover:underline"
            >
              gmgn.ai/ai
            </a>
            , then set <code className="font-mono">GMGN_API_KEY</code>.
          </p>
        </div>
      ) : trades.length === 0 ? (
        <p className="border-t border-white/5 px-4 py-10 text-center text-sm text-muted-foreground">
          {response ? "No tracked activity in this window." : "Loading…"}
        </p>
      ) : (
        <ul className="max-h-[26rem] overflow-y-auto border-t border-white/5">
          {trades.map((trade) => (
            <li
              key={trade.id}
              className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-b-0"
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full",
                  trade.side === "buy"
                    ? "bg-sol-green/10 text-sol-green-ink"
                    : "bg-destructive/10 text-destructive"
                )}
                title={trade.side === "buy" ? "Bought" : "Sold"}
              >
                {trade.side === "buy" ? (
                  <ArrowUpRight className="size-3.5" />
                ) : (
                  <ArrowDownRight className="size-3.5" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <span className="font-medium">{trade.traderName}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    {trade.side === "buy" ? "bought" : "sold"}{" "}
                  </span>
                  <span className="font-medium">${trade.symbol ?? "?"}</span>
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-[0.7rem] text-muted-foreground">
                  <span
                    className={cn(
                      "rounded px-1 py-px font-medium tracking-wide uppercase",
                      trade.source === "smart"
                        ? "bg-accent/10 text-accent"
                        : "bg-white/5"
                    )}
                  >
                    {trade.source === "smart" ? "smart money" : "kol"}
                  </span>
                  {trade.traderHandle && <span>@{trade.traderHandle}</span>}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-sm tabular-nums">
                  {trade.amountUsd != null ? formatUsd(trade.amountUsd) : "—"}
                </p>
                <p className="text-[0.7rem] text-muted-foreground">
                  {timeAgo(trade.timestamp, now)} ago
                </p>
              </div>

              <a
                href={`https://pump.fun/coin/${trade.token}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${trade.symbol ?? "token"}`}
                className="shrink-0 text-muted-foreground transition-colors hover:text-accent"
              >
                <ExternalLink className="size-4" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
