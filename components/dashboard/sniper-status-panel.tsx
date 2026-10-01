"use client";

import { Activity, AlertTriangle, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type DaemonStatus = "online" | "stale" | "never_started" | "unknown";

type SniperStateValue = {
  mode: "dry_run" | "live";
  tradingPaused: boolean;
  pauseReason: string | null;
  consecutiveLosses: string;
  dailyPnlSol: string;
};

type StatusResponse = {
  configured: boolean;
  status: DaemonStatus;
  state: SniperStateValue | null;
};

/** Mirrors the circuit-breaker thresholds in lib/sniper/config.ts#SniperConfig
 * — only the two fields this panel needs to give the live numbers context. */
type ConfigValue = {
  maxConsecutiveLosses: number;
  maxDailyDrawdownSol: number;
};

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

const DAEMON_LABEL: Record<DaemonStatus, string> = {
  online: "Daemon online",
  stale: "Daemon stale — may have crashed",
  never_started: "Daemon never started",
  unknown: "Daemon status unknown",
};

const DAEMON_DOT: Record<DaemonStatus, string> = {
  online: "bg-sol-green",
  stale: "bg-destructive animate-blink",
  never_started: "bg-muted-foreground/40",
  unknown: "bg-muted-foreground/40",
};

/** Read-only view of the Raven's safety state — daemon heartbeat and
 * circuit-breaker status. No pause/resume control here: since PR17
 * /api/sniper/toggle requires a house administrator (HOUSE_ADMIN_WALLETS),
 * and adding a kill switch to this public dashboard is a separate UI
 * decision. */
export function SniperStatusPanel() {
  const statusData = usePolledJson<StatusResponse>("/api/sniper/status", 10_000);
  const configData = usePolledJson<{ configured: boolean; config: ConfigValue | null }>(
    "/api/sniper/config",
    30_000
  );

  if (statusData && !statusData.configured) {
    return (
      <div className="overflow-hidden rounded-2xl bg-card p-5 text-sm text-muted-foreground">
        Connect DATABASE_URL to see the Raven&apos;s live status.
      </div>
    );
  }

  const state = statusData?.state ?? null;
  const daemonStatus = statusData?.status ?? "unknown";
  const config = configData?.config ?? null;

  const dailyPnl = state ? Number(state.dailyPnlSol) : null;
  // The house row is the retired Solana engine's last recorded state unless
  // something is actually heartbeating it (nothing does since PR09A).
  const historical = daemonStatus !== "online";
  const consecutiveLosses = state ? Number(state.consecutiveLosses) : null;

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3.5">
        <span className="flex items-center gap-1.5 text-[0.7rem] font-medium tracking-[0.15em] uppercase text-muted-foreground">
          <Activity className="size-3.5" />
          <span className={cn("inline-block size-1.5 rounded-full", DAEMON_DOT[daemonStatus])} />
          {DAEMON_LABEL[daemonStatus]}
        </span>

        <span className="h-4 w-px bg-white/10" />

        <span
          className={cn(
            "flex items-center gap-1.5 text-[0.7rem] font-medium tracking-[0.15em] uppercase",
            state?.tradingPaused ? "text-destructive" : "text-sol-green-ink"
          )}
        >
          {state?.tradingPaused ? (
            <ShieldAlert className="size-3.5" />
          ) : (
            <ShieldCheck className="size-3.5" />
          )}
          {state == null
            ? "Trading status unknown"
            : historical
              ? "Solana house engine · retired"
              : state.tradingPaused
                ? "Trading paused"
                : "Trading active"}
        </span>

        {state && (
          <span className="ml-auto rounded-full bg-secondary px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.1em] uppercase text-muted-foreground">
            {state.mode === "live" ? "Live" : "Dry-run"}
          </span>
        )}
      </div>

      {state?.tradingPaused && state.pauseReason && (
        <div className="flex items-start gap-2 border-t border-white/5 px-4 py-2.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Circuit breaker tripped — {state.pauseReason}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 p-1 pt-0">
        <div className="rounded-xl bg-secondary px-4 py-4">
          <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
            {historical ? "Last recorded P&L · Solana (historical)" : "Today’s P&L"}
          </p>
          <p
            className={cn(
              "mt-2.5 text-2xl font-medium tabular-nums",
              dailyPnl != null && dailyPnl < 0 && "text-destructive",
              dailyPnl != null && dailyPnl > 0 && "text-sol-green-ink"
            )}
          >
            {dailyPnl != null ? `${dailyPnl >= 0 ? "+" : ""}${dailyPnl.toFixed(3)} SOL` : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {historical
              ? "Not a live Robinhood figure — see per-bot desks"
              : config
                ? `Halts at −${config.maxDailyDrawdownSol} SOL`
                : "Daily drawdown halt"}
          </p>
        </div>
        <div className="rounded-xl bg-secondary px-4 py-4">
          <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
            Consecutive losses
          </p>
          <p className="mt-2.5 text-2xl font-medium tabular-nums">
            {consecutiveLosses ?? "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {config ? `Halts at ${config.maxConsecutiveLosses} in a row` : "Loss-streak halt"}
          </p>
        </div>
      </div>
    </div>
  );
}
