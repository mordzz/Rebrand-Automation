"use client";

import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { TokenIcon } from "@/components/token-icon";
import { getMarketLogo } from "@/lib/perps/markets";
import type { PerpspadToken } from "@/lib/perps/perpspad-types";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type TokensResponse = { configured: boolean; data: PerpspadToken[] };

/** Polls a JSON API; keeps the last good value on a transient fetch failure. */
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

const STATUS_CONFIG: Record<
  PerpspadToken["status"],
  { label: string; color: string; bg: string; dot: string }
> = {
  pending: {
    label: "Pending launch",
    color: "text-muted-foreground",
    bg: "bg-white/5",
    dot: "bg-muted-foreground",
  },
  active: {
    label: "Active",
    color: "text-[#5ed29c]",
    bg: "bg-[#5ed29c]/10",
    dot: "bg-[#5ed29c]",
  },
  low_health: {
    label: "Low Health",
    color: "text-[#f5a623]",
    bg: "bg-[#f5a623]/10",
    dot: "bg-[#f5a623]",
  },
  liquidated: {
    label: "Liquidated",
    color: "text-[#e2603f]",
    bg: "bg-[#e2603f]/10",
    dot: "bg-[#e2603f]",
  },
  accumulating: {
    label: "Accumulating",
    color: "text-muted-foreground",
    bg: "bg-white/5",
    dot: "bg-muted-foreground",
  },
};

const STATUS_ORDER = [
  "active",
  "low_health",
  "accumulating",
  "pending",
  "liquidated",
] as const;

function usd(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Every launched Perpspad token, from /api/perps/tokens - real (possibly
 * empty) data, not the MOCK_TOKENS this component used to render. Every
 * row currently comes back `status: "pending"` until the Phase 1
 * on-chain program exists to actually register/activate a token - see
 * the Perpspad plan. */
export function LivePositions({
  onLaunchClick,
}: {
  onLaunchClick?: () => void;
}) {
  const response = usePolledJson<TokensResponse>("/api/perps/tokens", 20_000);
  const tokens = response?.data ?? [];
  const loading = response == null;

  const totalFees = tokens.reduce((s, t) => s + (t.totalFeesCollected ?? 0), 0);
  const totalBurned = tokens.reduce((s, t) => s + (t.totalBurned ?? 0), 0);
  const activeCount = tokens.filter((t) => t.status === "active").length;

  return (
    <section className="pb-20">
      {/* Heading */}
      <div className="max-w-2xl">
        <p className="text-primary text-[10px] tracking-[0.3em] uppercase sm:text-xs">
          Live Positions
        </p>
        <h2 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">
          Launched{" "}
          <em className="font-instrument font-normal italic text-foreground/60">
            tokens.
          </em>
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Historical launches from the retired Solana/Drift Perpspad. New
          launches are paused.
        </p>
      </div>

      {/* Protocol stat strip - one row of real aggregates instead of a
          lone status chip stranded at the far edge of the header. */}
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/6 sm:grid-cols-4">
        <Stat label="Tokens launched" value={loading ? "-" : String(tokens.length)} />
        <Stat label="Active positions" value={loading ? "-" : String(activeCount)} />
        <Stat label="Fees routed" value={loading ? "-" : usd(totalFees)} />
        <Stat
          label="Tokens burned"
          value={loading ? "-" : totalBurned.toLocaleString("en-US")}
        />
      </div>

      {/* Status chips */}
      {tokens.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {STATUS_ORDER.map((s) => {
            const count = tokens.filter((t) => t.status === s).length;
            if (count === 0) return null;
            const cfg = STATUS_CONFIG[s];
            return (
              <span
                key={s}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold",
                  cfg.bg,
                  cfg.color,
                )}
              >
                <span className={cn("size-1.5 rounded-full", cfg.dot)} />
                {count} {cfg.label}
              </span>
            );
          })}
        </div>
      )}

      {tokens.length === 0 ? (
        <EmptyState loading={loading} onLaunchClick={onLaunchClick} />
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tokens.map((token, i) => {
            const cfg = STATUS_CONFIG[token.status];
            const isLong = token.direction === "LONG";
            const pnlPositive =
              token.unrealizedPnl != null && token.unrealizedPnl > 0;
            const pnlNegative =
              token.unrealizedPnl != null && token.unrealizedPnl < 0;

            return (
              <motion.div
                key={token.id}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.5, delay: Math.min(i, 8) * 0.06, ease: EASE }}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02] transition-colors duration-300 hover:border-white/14 hover:bg-white/[0.035]"
              >
                {/* Direction accent rail */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-0 left-0 w-px",
                    isLong ? "bg-[#5ed29c]/40" : "bg-[#e2603f]/40",
                  )}
                />

                {/* Header */}
                <div className="flex items-start justify-between gap-2 p-4 pb-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="relative shrink-0">
                      <TokenIcon
                        src={getMarketLogo(token.underlying)}
                        symbol={token.underlying}
                        className="size-8"
                      />
                      <span
                        className={cn(
                          "absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full border border-black text-[7px] font-bold leading-none",
                          isLong
                            ? "bg-[#5ed29c] text-black"
                            : "bg-[#e2603f] text-black",
                        )}
                        title={token.direction}
                      >
                        {isLong ? "↑" : "↓"}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">
                        {token.symbol}
                      </h3>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {token.name}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn("size-1.5 shrink-0 rounded-full", cfg.dot)}
                    title={cfg.label}
                  />
                </div>

                {/* Position summary line */}
                <div className="mx-4 flex items-center gap-1.5 rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-1.5">
                  <span
                    className={cn(
                      "text-[10px] font-semibold",
                      isLong ? "text-[#5ed29c]" : "text-[#e2603f]",
                    )}
                  >
                    {token.direction}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {token.underlying}
                  </span>
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-foreground/70">
                    {token.effectiveLeverage
                      ? `${token.effectiveLeverage.toFixed(1)}×`
                      : `${token.targetLeverage}× target`}
                  </span>
                </div>

                {/* Stats */}
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 px-4">
                  <StatRow label="Entry" value={usd(token.entryPrice)} />
                  <StatRow label="Mark" value={usd(token.currentPrice)} />
                  <StatRow label="Collateral" value={usd(token.collateral)} />
                  <StatRow
                    label="P&L"
                    value={
                      token.unrealizedPnl != null
                        ? `${token.unrealizedPnl >= 0 ? "+" : ""}${usd(token.unrealizedPnl)}`
                        : "-"
                    }
                    valueClass={cn(
                      pnlPositive && "text-[#5ed29c]",
                      pnlNegative && "text-[#e2603f]",
                    )}
                  />
                </div>

                {/* Health bar (only when a real ratio exists) */}
                {token.healthRatio != null && token.healthRatio > 0 && (
                  <div className="mt-3 px-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-muted-foreground">
                        Health
                      </span>
                      <span className="font-mono text-[9px] font-semibold tabular-nums text-foreground/70">
                        {(token.healthRatio * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          token.healthRatio > 0.5
                            ? "bg-[#5ed29c]"
                            : token.healthRatio > 0.25
                              ? "bg-[#f5a623]"
                              : "bg-[#e2603f]",
                        )}
                        style={{ width: `${token.healthRatio * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="mt-auto flex items-center gap-2 border-t border-white/6 px-4 py-2.5 pt-2.5">
                  <span className="text-[9px] text-muted-foreground">
                    Fees {usd(token.totalFeesCollected ?? 0)}
                  </span>
                  <span className="text-[9px] text-muted-foreground/40">·</span>
                  <span className="text-[9px] text-muted-foreground">
                    Burned {(token.totalBurned ?? 0).toLocaleString("en-US")}
                  </span>
                  {token.pendingFees != null && token.pendingFees > 0 && (
                    <span className="ml-auto font-mono text-[9px] font-medium text-primary">
                      {usd(token.pendingFees)} pending
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}

          {/* Fills the next grid slot rather than leaving a ragged row of
              dead space, and gives the tab an actual next step. */}
          {onLaunchClick && (
            <button
              type="button"
              onClick={onLaunchClick}
              className="group flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.012] p-5 text-center transition-colors hover:border-primary/30 hover:bg-primary/[0.03]"
            >
              <span className="flex size-9 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] text-muted-foreground transition-colors group-hover:border-primary/25 group-hover:text-primary">
                <svg
                  className="size-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
              </span>
              <span className="text-xs font-semibold text-foreground/75 transition-colors group-hover:text-foreground">
                Launch a token
              </span>
              <span className="text-[10px] leading-relaxed text-muted-foreground">
                Pick a market, direction and leverage
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyState({
  loading,
  onLaunchClick,
}: {
  loading: boolean;
  onLaunchClick?: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-20 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03]">
        <svg
          className="size-5 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
          />
        </svg>
      </div>
      <p className="mt-4 text-sm font-medium text-foreground/80">
        {loading ? "Loading tokens…" : "No tokens launched yet"}
      </p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {loading
          ? "Fetching the registry."
          : "The first perp-backed token will appear here the moment it launches."}
      </p>
      {!loading && onLaunchClick && (
        <button
          type="button"
          onClick={onLaunchClick}
          className="mt-5 rounded-xl px-5 py-2.5 text-xs font-semibold text-black transition-shadow hover:shadow-[0_0_24px_rgba(222,219,200,0.25)]"
          style={{ background: "#DEDBC8" }}
        >
          Launch the first one
        </button>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-4 py-4">
      <p className="text-[9px] tracking-[0.15em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-lg tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function StatRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span
        className={cn("font-mono text-[11px] font-semibold tabular-nums", valueClass)}
      >
        {value}
      </span>
    </div>
  );
}
