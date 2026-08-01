"use client";

import { Bot, Brain, Cable, Gauge, MessageSquareText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { ExecutionTerminal } from "@/components/dashboard/execution-terminal";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

type ProviderId = "openrouter" | "anthropic" | "openai";

/* Same 3 validated categorical slots this project already uses elsewhere
   (light on #faf9f5, dark on #30302e) — anthropic/openai keep their prior
   slots, openrouter takes the 3rd slot the old "gemini" mock occupied.
   Fixed order, not re-picked, per the dataviz skill's "never cycle
   categorical hues" rule. */
const CHART_CONFIG = {
  anthropic: {
    label: "Claude Opus 5",
    theme: { light: "#c96442", dark: "#d47250" },
  },
  openai: {
    label: "GPT-5.6 Sol",
    theme: { light: "#2e74ad", dark: "#3f82bd" },
  },
  openrouter: {
    label: "Kimi K3",
    theme: { light: "#9c7e16", dark: "#ab8b1d" },
  },
} satisfies ChartConfig;

type ProviderStatusRow = {
  id: ProviderId;
  name: string;
  configured: boolean;
  enabled: boolean;
};

type HourBucket = { hour: string } & Record<ProviderId, number>;

type ModelUsageResponse = {
  configured: boolean;
  providers: ProviderStatusRow[];
  hourly: HourBucket[];
  totalRequests24h: number;
  avgLatencyMs: number | null;
};

type MemoryRow = {
  id: string;
  date: string;
  token: string;
  strategy: string;
  pnl: string;
  cause: string;
  lesson: string;
  status: "applied" | "learning";
  suggestedConfig: Record<string, unknown> | null;
};

/** Shape of a row returned by GET /api/lessons */
type LessonApiRow = {
  id: string;
  cause: string;
  lesson: string;
  status: string;
  suggestedConfig: Record<string, unknown> | null;
  createdAt: string;
  token: string | null;
  strategy: string | null;
  pnlSol: string | null;
  closedAt: string | null;
};

function toMemoryRow(row: LessonApiRow): MemoryRow {
  const pnl = Number(row.pnlSol ?? 0);
  return {
    id: row.id,
    date: new Date(row.closedAt ?? row.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    token: row.token ?? "—",
    strategy: row.strategy ?? "—",
    pnl: `${pnl > 0 ? "+" : ""}${pnl} SOL`,
    cause: row.cause,
    lesson: row.lesson,
    status: row.status === "applied" ? "applied" : "learning",
    suggestedConfig: row.suggestedConfig,
  };
}

/** Turns {maxHoldTimeSec: 900} into "maxHoldTimeSec → 900" for a compact
 * one-line preview of what "Apply" would actually change. */
function summarizeSuggestion(config: Record<string, unknown>): string {
  return Object.entries(config)
    .map(([key, value]) => `${key} → ${value}`)
    .join(", ");
}

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

/** `officialWallet` scopes the execution terminal and agent-memory table
 * to Noah's own ledger (same `?wallet=` convention BotDesk uses) — the
 * defaults below (`/api/logs`, `/api/lessons`) are house-scoped and read
 * from rows nothing currently deployed writes to. */
export function LlmConnections({ officialWallet }: { officialWallet?: string } = {}) {
  const walletQuery = officialWallet ? `wallet=${encodeURIComponent(officialWallet)}` : null;

  const usage = usePolledJson<ModelUsageResponse>("/api/model-usage", 5_000);
  const lessonsResponse = usePolledJson<{ configured: boolean; data: LessonApiRow[] }>(
    walletQuery ? `/api/lessons?${walletQuery}` : "/api/lessons",
    15_000
  );

  const providers = usage?.providers ?? [];
  const memoryRows: MemoryRow[] = (lessonsResponse?.data ?? []).map(toMemoryRow);
  const memoryLive = lessonsResponse?.configured === true;

  // Optimistic — the real status also flips server-side; this just avoids
  // waiting out the 15s poll before the button's own row updates.
  const [locallyApplied, setLocallyApplied] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);

  async function applySuggestion(id: string) {
    setApplyingId(id);
    try {
      const res = await fetch(`/api/lessons/${id}/apply`, { method: "POST" });
      if (res.ok) {
        setLocallyApplied((prev) => new Set(prev).add(id));
      }
    } finally {
      setApplyingId(null);
    }
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<HTMLDivElement>(null);
  const nodeRefs: Record<ProviderId, React.RefObject<HTMLDivElement | null>> = {
    openrouter: useRef<HTMLDivElement>(null),
    anthropic: useRef<HTMLDivElement>(null),
    openai: useRef<HTMLDivElement>(null),
  };

  const connectedCount = providers.filter((p) => p.enabled).length;

  return (
    <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5">
      {/* Connections diagram */}
      <div className="min-w-0 rounded-2xl bg-card lg:col-span-2">
        <div className="px-4 py-3">
          <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Model Connections
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Real LLM providers wired into the house agent — set via env vars,
            not a UI toggle (see .env.example).
          </p>
        </div>

        <div
          ref={containerRef}
          className="relative flex items-center justify-between px-8 py-6"
        >
          {providers.map(
            (p, i) =>
              p.enabled && (
                <AnimatedBeam
                  key={p.id}
                  containerRef={containerRef}
                  fromRef={nodeRefs[p.id]}
                  toRef={agentRef}
                  curvature={(1 - i) * -28}
                  duration={4 + i}
                  delay={i * 0.6}
                  pathColor="var(--border)"
                  pathOpacity={0.6}
                  pathWidth={1.5}
                  gradientStartColor="#dedbc8"
                  gradientStopColor="#8a877a"
                />
              )
          )}

          <div className="z-10 flex flex-col gap-3">
            {providers.map((p) => (
              <div
                key={p.id}
                ref={nodeRefs[p.id]}
                className={cn(
                  "flex size-10 items-center justify-center rounded-full bg-secondary text-xs font-semibold transition-opacity",
                  p.enabled ? "" : "opacity-35"
                )}
                title={p.name}
              >
                {p.id === "openrouter" ? "KM" : p.id === "anthropic" ? "CL" : "GP"}
              </div>
            ))}
          </div>

          <div
            ref={agentRef}
            className="z-10 flex size-16 items-center justify-center rounded-full bg-primary"
          >
            <Bot className="size-7 text-black" />
          </div>
        </div>

        <ul>
          {providers.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-b-0"
            >
              <span
                className="inline-block size-2 rounded-full"
                style={{
                  backgroundColor: `var(--color-${p.id}, var(--muted-foreground))`,
                  opacity: p.enabled ? 1 : 0.3,
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.configured ? "API key configured" : "No API key set"}
                </p>
              </div>
              <span
                className={cn(
                  "text-xs",
                  p.enabled ? "text-sol-green-ink" : "text-muted-foreground"
                )}
              >
                {p.enabled ? "Connected" : p.configured ? "Disabled" : "Off"}
              </span>
            </li>
          ))}
          {providers.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              Loading provider status…
            </li>
          )}
        </ul>
      </div>

      {/* Stats + usage chart */}
      <div className="min-w-0 rounded-2xl bg-card lg:col-span-3">
        <div className="grid grid-cols-3 gap-1 p-1">
          <div className="rounded-xl bg-secondary px-4 py-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Cable className="size-3.5" />
              <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase">
                Models connected
              </p>
            </div>
            <p className="mt-2.5 text-2xl font-medium">
              {connectedCount}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                of {providers.length || 3}
              </span>
            </p>
          </div>
          <div className="rounded-xl bg-secondary px-4 py-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MessageSquareText className="size-3.5" />
              <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase">
                Requests · 24h
              </p>
            </div>
            <p className="mt-2.5 text-2xl font-medium">
              {(usage?.totalRequests24h ?? 0).toLocaleString("en-US")}
            </p>
          </div>
          <div className="rounded-xl bg-secondary px-4 py-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Gauge className="size-3.5" />
              <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase">
                Avg latency
              </p>
            </div>
            <p className="mt-2.5 text-2xl font-medium">
              {usage?.avgLatencyMs != null ? (
                <>
                  {Math.round(usage.avgLatencyMs)}
                  <span className="text-sm font-normal text-muted-foreground">ms</span>
                </>
              ) : (
                "—"
              )}
            </p>
          </div>
        </div>

        <div className="p-4">
          <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Inference Requests · Last 24h
          </p>
          {usage?.configured && (usage.hourly.length === 0 || usage.totalRequests24h === 0) ? (
            <div className="mt-3 flex h-64 items-center justify-center text-sm text-muted-foreground">
              No model requests yet — chat with Noah to see real traffic here.
            </div>
          ) : !usage?.configured ? (
            <div className="mt-3 flex h-64 items-center justify-center text-sm text-muted-foreground">
              Connect DATABASE_URL to track real usage.
            </div>
          ) : (
            <ChartContainer config={CHART_CONFIG} className="mt-3 h-64 w-full">
              <LineChart data={usage.hourly} margin={{ left: 4, right: 12, top: 4 }}>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="hour"
                  tickLine={false}
                  axisLine={false}
                  interval={5}
                  tickMargin={8}
                />
                <YAxis width={36} tickLine={false} axisLine={false} tickMargin={4} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Line
                  dataKey="openrouter"
                  type="monotone"
                  stroke="var(--color-openrouter)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  dataKey="anthropic"
                  type="monotone"
                  stroke="var(--color-anthropic)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  dataKey="openai"
                  type="monotone"
                  stroke="var(--color-openai)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ChartContainer>
          )}
        </div>
      </div>

      {/* Live execution log — sits directly below the chart */}
      <div className="min-w-0 lg:col-span-5">
        <ExecutionTerminal
          endpoint={walletQuery ? `/api/my-bot/activity?${walletQuery}` : undefined}
        />
      </div>

      {/* Agent memory — losses distilled into rules */}
      <div className="min-w-0 overflow-hidden rounded-2xl bg-card lg:col-span-5">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Brain className="size-4" />
            </span>
            <div>
              <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
                Agent Memory
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Every losing trade is analysed and stored as a rule the
                connected models reuse on the next decision.
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">
              {memoryRows.length} lesson{memoryRows.length === 1 ? "" : "s"} stored
            </p>
            <p
              className={cn(
                "text-xs",
                memoryLive ? "text-sol-green-ink" : "text-muted-foreground"
              )}
            >
              {memoryLive ? "Live from database" : "Connect DATABASE_URL to go live"}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="px-4 py-3 text-[0.65rem] font-semibold tracking-[0.15em] uppercase">Closed</th>
                <th className="px-4 py-3 text-[0.65rem] font-semibold tracking-[0.15em] uppercase">Token</th>
                <th className="px-4 py-3 text-[0.65rem] font-semibold tracking-[0.15em] uppercase">Strategy</th>
                <th className="px-4 py-3 text-[0.65rem] font-semibold tracking-[0.15em] uppercase">Loss</th>
                <th className="px-4 py-3 text-[0.65rem] font-semibold tracking-[0.15em] uppercase">Why it lost</th>
                <th className="px-4 py-3 text-[0.65rem] font-semibold tracking-[0.15em] uppercase">Lesson stored</th>
                <th className="px-4 py-3 text-right text-[0.65rem] font-semibold tracking-[0.15em] uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {!memoryLive ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Connect DATABASE_URL to see real agent memory.
                  </td>
                </tr>
              ) : memoryRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No lessons yet — the first losing trade will be analysed and stored here.
                  </td>
                </tr>
              ) : (
                memoryRows.map((m) => {
                  const applied = m.status === "applied" || locallyApplied.has(m.id);
                  const canApply = m.suggestedConfig && !applied;
                  return (
                    <tr key={m.id} className="border-b border-white/5 last:border-b-0">
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {m.date}
                      </td>
                      <td className="px-4 py-3 font-medium">${m.token}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {m.strategy}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-destructive">
                        {m.pnl}
                      </td>
                      <td className="max-w-64 px-4 py-3 text-muted-foreground">{m.cause}</td>
                      <td className="max-w-64 px-4 py-3">
                        <p>{m.lesson}</p>
                        {m.suggestedConfig && (
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            {summarizeSuggestion(m.suggestedConfig)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                              applied
                                ? "bg-accent/10 text-accent"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {!applied && (
                              <span className="inline-block size-1.5 animate-blink rounded-full bg-current" />
                            )}
                            {applied ? "Applied" : "Learning"}
                          </span>
                          {canApply && (
                            <button
                              onClick={() => applySuggestion(m.id)}
                              disabled={applyingId === m.id}
                              className="text-xs text-accent underline-offset-2 hover:underline disabled:opacity-50"
                            >
                              {applyingId === m.id ? "Applying…" : "Apply suggestion"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
