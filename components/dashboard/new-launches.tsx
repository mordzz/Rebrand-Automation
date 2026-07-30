"use client";

import { ExternalLink, Lock, Rocket, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { TokenIcon } from "@/components/token-icon";
import { cn } from "@/lib/utils";

type DiscoveredToken = {
  mint: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  launchpad: string | null;
  createdAt: number;
  mintAuthorityRenounced: boolean | null;
  freezeAuthorityRenounced: boolean | null;
  hasSocialLink: boolean;
  isHoneypot: boolean | null;
  rugRatio: number | null;
  top10HolderRate: number | null;
  bundlerRate: number | null;
  marketCapUsd: number | null;
  holderCount: number | null;
  smartMoneyCount: number | null;
  kolCount: number | null;
};

type DiscoveryResponse = { configured: boolean; tokens: DiscoveredToken[] };

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
        // keep the last good value
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

function ageLabel(createdAt: number, now: number): string {
  const s = Math.max(0, Math.round(now / 1000 - createdAt));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function formatUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

/** Cheap, honest read of the risk fields GMGN ships with each token. Not a
 * trading verdict — the engine's own gate (lib/gmgn/safety.ts) decides
 * that. This only flags what a human scanning the list should notice. */
function riskFlags(t: DiscoveredToken): string[] {
  const flags: string[] = [];
  if (t.isHoneypot === true) flags.push("honeypot");
  if (t.mintAuthorityRenounced === false) flags.push("mint live");
  if (t.freezeAuthorityRenounced === false) flags.push("freeze live");
  if (t.rugRatio != null && t.rugRatio > 0.1) flags.push("dev rug history");
  if (t.bundlerRate != null && t.bundlerRate > 0.3) flags.push("bundled");
  if (t.top10HolderRate != null && t.top10HolderRate > 0.35) flags.push("top-10 heavy");
  return flags;
}

/** New launches across every Solana launchpad GMGN indexes, not just
 * pump.fun — the coverage gap the PumpPortal stream alone leaves. */
export function NewLaunches() {
  const response = usePolledJson<DiscoveryResponse>("/api/discovery", 10_000);
  const [now, setNow] = useState(() => Date.now());
  const [platform, setPlatform] = useState<string>("all");

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(tick);
  }, []);

  // Memoised so the `?? []` fallback doesn't hand useMemo a fresh array
  // identity on every render and defeat the platform-count memo below.
  const tokens = useMemo(() => response?.tokens ?? [], [response?.tokens]);

  const platforms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tokens) {
      const p = t.launchpad ?? "unknown";
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [tokens]);

  const visible =
    platform === "all" ? tokens : tokens.filter((t) => (t.launchpad ?? "unknown") === platform);

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Rocket className="size-4" />
          </span>
          <div>
            <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
              New launches · all launchpads
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              pump.fun, bags, believe, letsbonk, boop, moonshot and more.
            </p>
          </div>
        </div>
        {response?.configured && (
          <span className="text-[0.7rem] text-muted-foreground">
            {visible.length} live
          </span>
        )}
      </div>

      {response && !response.configured ? (
        <div className="border-t border-white/5 px-4 py-8 text-center">
          <p className="flex items-center justify-center gap-2 text-xs font-medium tracking-[0.15em] uppercase text-muted-foreground">
            <Lock className="size-3.5" />
            Not connected
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Multi-launchpad discovery needs a GMGN API key. Set{" "}
            <code className="font-mono">GMGN_API_KEY</code> to light this up.
          </p>
        </div>
      ) : (
        <>
          {platforms.length > 1 && (
            <div className="flex flex-wrap gap-1 border-t border-white/5 px-4 py-2.5">
              <button
                type="button"
                onClick={() => setPlatform("all")}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
                  platform === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                )}
              >
                All
              </button>
              {platforms.map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setPlatform(name)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[0.7rem] font-medium transition-colors",
                    platform === name
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  )}
                >
                  {name} <span className="opacity-60">{count}</span>
                </button>
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <p className="border-t border-white/5 px-4 py-10 text-center text-sm text-muted-foreground">
              {response ? "No launches in this window." : "Loading…"}
            </p>
          ) : (
            <ul className="max-h-[24rem] overflow-y-auto border-t border-white/5">
              {visible.map((t) => {
                const flags = riskFlags(t);
                return (
                  <li
                    key={t.mint}
                    className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-b-0"
                  >
                    {/* Icon carries the risk verdict as a ring so the row
                        keeps one visual anchor instead of two. */}
                    <span
                      className={cn(
                        "relative shrink-0 rounded-full ring-2",
                        flags.length === 0 ? "ring-sol-green/40" : "ring-destructive/40"
                      )}
                      title={flags.length === 0 ? "No risk flags" : flags.join(", ")}
                    >
                      <TokenIcon src={t.logo} symbol={t.symbol} className="size-8" />
                      <span
                        className={cn(
                          "absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-card",
                          flags.length === 0 ? "text-sol-green-ink" : "text-destructive"
                        )}
                      >
                        {flags.length === 0 ? (
                          <ShieldCheck className="size-3" />
                        ) : (
                          <ShieldAlert className="size-3" />
                        )}
                      </span>
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        ${t.symbol ?? "?"}
                        <span className="ml-2 text-[0.7rem] font-normal text-muted-foreground">
                          {t.launchpad}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-[0.7rem] text-muted-foreground">
                        {flags.length > 0 ? (
                          <span className="text-destructive">{flags.join(" · ")}</span>
                        ) : (
                          <>
                            {t.holderCount ?? 0} holders
                            {(t.smartMoneyCount ?? 0) > 0 && (
                              <span className="text-accent"> · {t.smartMoneyCount} smart</span>
                            )}
                            {(t.kolCount ?? 0) > 0 && (
                              <span className="text-accent"> · {t.kolCount} KOL</span>
                            )}
                          </>
                        )}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-xs tabular-nums">
                        {t.marketCapUsd != null ? formatUsd(t.marketCapUsd) : "—"}
                      </p>
                      <p className="text-[0.7rem] text-muted-foreground">
                        {ageLabel(t.createdAt, now)}
                      </p>
                    </div>

                    <a
                      href={`https://pump.fun/coin/${t.mint}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${t.symbol ?? "token"}`}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-accent"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
