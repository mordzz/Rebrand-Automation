"use client";

import { Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";

/** Mirrors lib/sniper/config.ts#SniperConfig — kept as a plain type here
 * (not imported) since this file is a client component and the source
 * type lives in server-only code that also touches the DB driver. */
type TakeProfitTier = { atPct: number; sellPortionPct: number };

type SniperConfigValue = {
  requireMintAuthorityRenounced: boolean;
  requireFreezeAuthorityRenounced: boolean;
  requireSocialLink: boolean;
  maxCreatorBuyPct: number;
  minTokenAgeSec: number;
  maxTokenAgeSec: number | null;
  blockedKeywords: string[];
  maxSolPerSnipe: number;
  maxConcurrentPositions: number;
  maxTotalDeployedSol: number;
  exitMode: "fixed" | "tiered";
  takeProfitPct: number;
  stopLossPct: number;
  takeProfitTiers: TakeProfitTier[];
  trailingStopEnabled: boolean;
  trailingStopActivationPct: number;
  trailingStopPct: number;
  breakevenAfterPct: number | null;
  maxHoldTimeSec: number | null;
  crashDropPct: number;
  exitCheckIntervalMs: number;
  maxConsecutiveLosses: number;
  maxDailyDrawdownSol: number;
  cooldownAfterLossSec: number;
  metadataFetchTimeoutMs: number;
};

/** Polls a JSON API; keeps the last good value on a transient fetch failure. */
function usePolledJson<T>(url: string, intervalMs: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const res = await fetch(url);
        const json = await res.json();
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

type SpecRow = { label: string; value: string };

function buildSections(c: SniperConfigValue): { title: string; rows: SpecRow[] }[] {
  const exitRows: SpecRow[] =
    c.exitMode === "tiered" && c.takeProfitTiers.length > 0
      ? c.takeProfitTiers.map((tier, i) => ({
          label: `Take-profit · tier ${i + 1}`,
          value: `at +${tier.atPct}% sell ${tier.sellPortionPct}%`,
        }))
      : [{ label: "Take-profit", value: `+${c.takeProfitPct}%` }];

  return [
    {
      title: "Entry Filters",
      rows: [
        {
          label: "Mint authority",
          value: c.requireMintAuthorityRenounced ? "Renounced only" : "Any",
        },
        {
          label: "Freeze authority",
          value: c.requireFreezeAuthorityRenounced ? "Renounced only" : "Any",
        },
        {
          label: "Social link",
          value: c.requireSocialLink ? "Required" : "Optional",
        },
        { label: "Max creator buy", value: `${c.maxCreatorBuyPct}%` },
        { label: "Min token age", value: `${c.minTokenAgeSec}s` },
        {
          label: "Max queue age",
          value: c.maxTokenAgeSec != null ? `${c.maxTokenAgeSec}s` : "Off",
        },
        {
          label: "Blocked keywords",
          value: c.blockedKeywords.length ? c.blockedKeywords.join(", ") : "None",
        },
      ],
    },
    {
      title: "Sizing · Circuit Breaker",
      rows: [
        { label: "Per snipe", value: `${c.maxSolPerSnipe} SOL` },
        { label: "Max concurrent positions", value: String(c.maxConcurrentPositions) },
        { label: "Max total deployed", value: `${c.maxTotalDeployedSol} SOL` },
        { label: "Max consecutive losses", value: String(c.maxConsecutiveLosses) },
        { label: "Daily drawdown halt", value: `${c.maxDailyDrawdownSol} SOL` },
        { label: "Cooldown after a loss", value: `${c.cooldownAfterLossSec}s` },
        { label: "Exit check interval", value: `${c.exitCheckIntervalMs}ms` },
      ],
    },
    {
      title: "Exit Strategy",
      rows: [
        { label: "Mode", value: c.exitMode === "tiered" ? "Tiered" : "Fixed" },
        ...exitRows,
        { label: "Stop-loss", value: `−${c.stopLossPct}%` },
        {
          label: "Trailing stop",
          value: c.trailingStopEnabled
            ? `arms +${c.trailingStopActivationPct}% · trail ${c.trailingStopPct}%`
            : "Off",
        },
        {
          label: "Breakeven lock",
          value: c.breakevenAfterPct != null ? `+${c.breakevenAfterPct}%` : "Off",
        },
        {
          label: "Force time-exit",
          value: c.maxHoldTimeSec != null ? `${c.maxHoldTimeSec}s` : "Off",
        },
        { label: "Crash exit", value: `−${c.crashDropPct}% / check` },
      ],
    },
  ];
}

/** Read-only view of the Sniper's live config for the demo desk — the
 * interactive editor (sniper-config-panel.tsx) is reserved for the
 * upcoming deploy-your-own-bot flow. */
export function SniperConfigReadout() {
  const response = usePolledJson<{
    configured: boolean;
    config: SniperConfigValue | null;
  }>("/api/sniper/config", 10_000);

  if (response && !response.configured) {
    return (
      <div className="rounded-2xl bg-card p-5 text-sm text-muted-foreground">
        Connect DATABASE_URL to see the Raven&apos;s live configuration.
      </div>
    );
  }

  if (!response?.config) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-card p-5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading Raven configuration…
      </div>
    );
  }

  const sections = buildSections(response.config);

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            The Raven · Live Config
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The rules the house automaton trades by, straight from the desk.
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
          <Lock className="size-3" />
          Read-only · Demo
        </span>
      </div>

      <div className="grid gap-1 p-1 pt-0 lg:grid-cols-3">
        {sections.map((section) => (
          <div key={section.title} className="rounded-xl bg-secondary px-5 py-4">
            <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
              {section.title}
            </p>
            <dl className="mt-3.5 space-y-2.5">
              {section.rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-4"
                >
                  <dt className="shrink-0 text-xs text-muted-foreground">
                    {row.label}
                  </dt>
                  <dd className="min-w-0 text-right font-mono text-xs font-medium break-words tabular-nums">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
