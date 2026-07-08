"use client";

import { Bot, Brain, Cable, Gauge, MessageSquareText } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { AnimatedBeam } from "@/components/ui/animated-beam";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type ModelId = "claude" | "gpt" | "gemini" | "llama" | "deepseek";

const MODELS: {
  id: ModelId;
  name: string;
  provider: string;
  short: string;
  latency: string;
  charted: boolean;
}[] = [
  { id: "claude", name: "Claude Fable 5", provider: "Anthropic", short: "CL", latency: "640ms", charted: true },
  { id: "gpt", name: "GPT-5", provider: "OpenAI", short: "G5", latency: "710ms", charted: true },
  { id: "gemini", name: "Gemini 3 Pro", provider: "Google", short: "GM", latency: "820ms", charted: true },
  { id: "llama", name: "Llama 4", provider: "Meta", short: "L4", latency: "480ms", charted: false },
  { id: "deepseek", name: "DeepSeek V4", provider: "DeepSeek", short: "DS", latency: "902ms", charted: false },
];

/* Entity colors validated with the dataviz palette checker
   (light on #faf9f5, dark on #30302e — all checks pass) */
const CHART_CONFIG = {
  claude: {
    label: "Claude",
    theme: { light: "#c96442", dark: "#d47250" },
  },
  gpt: {
    label: "GPT-5",
    theme: { light: "#2e74ad", dark: "#3f82bd" },
  },
  gemini: {
    label: "Gemini",
    theme: { light: "#9c7e16", dark: "#ab8b1d" },
  },
} satisfies ChartConfig;

/* Losses distilled into rules the connected models reuse */
const MEMORY: {
  date: string;
  token: string;
  strategy: string;
  pnl: string;
  cause: string;
  lesson: string;
  status: "Applied" | "Learning";
}[] = [
  {
    date: "Jul 7",
    token: "BODEN",
    strategy: "The Sniper",
    pnl: "-1.2 SOL",
    cause: "Entered a pool with unlocked LP; rugged 4 minutes after entry",
    lesson: "Require LP locked or burned before any snipe",
    status: "Applied",
  },
  {
    date: "Jul 6",
    token: "PONKE",
    strategy: "The Shadow",
    pnl: "-0.8 SOL",
    cause: "Mirrored the leader's exit 45 seconds late",
    lesson: "Cap mirror latency at one block; skip the trade if missed",
    status: "Applied",
  },
  {
    date: "Jul 5",
    token: "SLERF",
    strategy: "The Sniper",
    pnl: "-0.5 SOL",
    cause: "Chased three green candles and bought the local top",
    lesson: "Never enter later than block 5 after launch",
    status: "Applied",
  },
  {
    date: "Jul 4",
    token: "MYRO",
    strategy: "The Clockwork",
    pnl: "-0.3 SOL",
    cause: "Kept laddering through a 40% drawdown",
    lesson: "Pause the ladder when 24h drawdown exceeds 15%",
    status: "Learning",
  },
  {
    date: "Jul 3",
    token: "WIF",
    strategy: "The Sentry",
    pnl: "-0.6 SOL",
    cause: "Trailing stop at 5% was shaken out before the run",
    lesson: "Widen the trail to 12% on high-volatility pairs",
    status: "Applied",
  },
  {
    date: "Jul 2",
    token: "GIGA",
    strategy: "The Shadow",
    pnl: "-1.1 SOL",
    cause: "Copied a wallet that bundle-dumped its own token",
    lesson: "Blacklist wallets with dev-linked funding",
    status: "Learning",
  },
];

/* Deterministic mock: requests per hour per model */
const USAGE = Array.from({ length: 24 }, (_, h) => ({
  hour: `${String(h).padStart(2, "0")}:00`,
  claude: Math.round(150 + 90 * Math.sin((h - 7) / 3.4) + (h % 5) * 8),
  gpt: Math.round(110 + 60 * Math.sin((h - 10) / 3.1) + (h % 4) * 7),
  gemini: Math.round(75 + 45 * Math.sin((h - 5) / 2.8) + (h % 3) * 6),
}));

export function LlmConnections() {
  const [connected, setConnected] = useState<Record<ModelId, boolean>>({
    claude: true,
    gpt: true,
    gemini: true,
    llama: false,
    deepseek: false,
  });
  const [autoConnect, setAutoConnect] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<HTMLDivElement>(null);
  const nodeRefs = {
    claude: useRef<HTMLDivElement>(null),
    gpt: useRef<HTMLDivElement>(null),
    gemini: useRef<HTMLDivElement>(null),
    llama: useRef<HTMLDivElement>(null),
    deepseek: useRef<HTMLDivElement>(null),
  };

  function toggle(id: ModelId, value: boolean) {
    setConnected((c) => ({ ...c, [id]: value }));
    if (!value) setAutoConnect(false);
  }

  function toggleAuto(value: boolean) {
    setAutoConnect(value);
    if (value) {
      setConnected({
        claude: true,
        gpt: true,
        gemini: true,
        llama: true,
        deepseek: true,
      });
    }
  }

  const connectedCount = Object.values(connected).filter(Boolean).length;

  const totals = useMemo(() => {
    const chartedIds = MODELS.filter((m) => m.charted).map((m) => m.id) as (
      | "claude"
      | "gpt"
      | "gemini"
    )[];
    let requests = 0;
    for (const row of USAGE) {
      for (const id of chartedIds) {
        if (connected[id]) requests += row[id];
      }
    }
    return { requests };
  }, [connected]);

  return (
    <section className="mt-5 grid gap-5 lg:grid-cols-5">
      {/* Connections diagram + settings */}
      <div className="rounded-xl border bg-card lg:col-span-2">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-sm font-medium">Model connections</p>
            <p className="text-xs text-muted-foreground">
              LLMs wired into the house agent
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Auto-connect
            <Switch
              size="sm"
              checked={autoConnect}
              onCheckedChange={toggleAuto}
            />
          </label>
        </div>

        <div
          ref={containerRef}
          className="relative flex items-center justify-between px-8 py-6"
        >
          {/* beams under the nodes */}
          {MODELS.map(
            (m, i) =>
              connected[m.id] && (
                <AnimatedBeam
                  key={m.id}
                  containerRef={containerRef}
                  fromRef={nodeRefs[m.id]}
                  toRef={agentRef}
                  curvature={(2 - i) * -28}
                  duration={4 + i}
                  delay={i * 0.6}
                  pathColor="var(--border)"
                  pathOpacity={0.6}
                  pathWidth={1.5}
                  gradientStartColor="#d97757"
                  gradientStopColor="#c96442"
                />
              )
          )}

          <div className="z-10 flex flex-col gap-3">
            {MODELS.map((m) => (
              <div
                key={m.id}
                ref={nodeRefs[m.id]}
                className={cn(
                  "flex size-10 items-center justify-center rounded-full border bg-background text-xs font-semibold transition-opacity",
                  connected[m.id] ? "border-accent/50" : "opacity-35"
                )}
                title={m.name}
              >
                {m.short}
              </div>
            ))}
          </div>

          <div
            ref={agentRef}
            className="z-10 flex size-16 items-center justify-center rounded-full border-2 border-accent bg-background"
          >
            <Bot className="size-7 text-accent" />
          </div>
        </div>

        <ul className="border-t">
          {MODELS.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
            >
              <span
                className="inline-block size-2 rounded-full"
                style={{
                  backgroundColor: m.charted
                    ? `var(--color-${m.id}, var(--muted-foreground))`
                    : "var(--muted-foreground)",
                  opacity: connected[m.id] ? 1 : 0.3,
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground">
                  {m.provider} · {m.latency} avg
                </p>
              </div>
              <span
                className={cn(
                  "text-xs",
                  connected[m.id]
                    ? "text-emerald-700"
                    : "text-muted-foreground"
                )}
              >
                {connected[m.id] ? "Connected" : "Off"}
              </span>
              <Switch
                checked={connected[m.id]}
                onCheckedChange={(v) => toggle(m.id, v)}
                aria-label={`Connect ${m.name}`}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* Stats + usage chart */}
      <div className="rounded-xl border bg-card lg:col-span-3">
        <div className="grid grid-cols-3 divide-x border-b">
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Cable className="size-4" />
              <p className="text-xs">Models connected</p>
            </div>
            <p className="mt-1 font-display text-2xl font-medium">
              {connectedCount}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                of {MODELS.length}
              </span>
            </p>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MessageSquareText className="size-4" />
              <p className="text-xs">Requests · 24h</p>
            </div>
            <p className="mt-1 font-display text-2xl font-medium">
              {totals.requests.toLocaleString("en-US")}
            </p>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Gauge className="size-4" />
              <p className="text-xs">Avg latency</p>
            </div>
            <p className="mt-1 font-display text-2xl font-medium">
              724<span className="text-sm font-normal text-muted-foreground">ms</span>
            </p>
          </div>
        </div>

        <div className="p-4">
          <p className="text-sm font-medium">Inference requests · last 24h</p>
          <ChartContainer
            config={CHART_CONFIG}
            className="mt-3 h-64 w-full"
          >
            <LineChart data={USAGE} margin={{ left: 4, right: 12, top: 4 }}>
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
              <YAxis
                width={36}
                tickLine={false}
                axisLine={false}
                tickMargin={4}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {connected.claude && (
                <Line
                  dataKey="claude"
                  type="monotone"
                  stroke="var(--color-claude)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
              {connected.gpt && (
                <Line
                  dataKey="gpt"
                  type="monotone"
                  stroke="var(--color-gpt)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
              {connected.gemini && (
                <Line
                  dataKey="gemini"
                  type="monotone"
                  stroke="var(--color-gemini)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
            </LineChart>
          </ChartContainer>
        </div>
      </div>

      {/* Agent memory — losses distilled into rules */}
      <div className="overflow-hidden rounded-xl border bg-card lg:col-span-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Brain className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium">Agent memory</p>
              <p className="text-xs text-muted-foreground">
                Every losing trade is analysed and stored as a rule the
                connected models reuse on the next decision.
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">{MEMORY.length} lessons stored</p>
            <p className="text-xs text-emerald-700">
              +9% win rate since learning began
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Closed</th>
                <th className="px-4 py-3 font-medium">Token</th>
                <th className="px-4 py-3 font-medium">Strategy</th>
                <th className="px-4 py-3 font-medium">Loss</th>
                <th className="px-4 py-3 font-medium">Why it lost</th>
                <th className="px-4 py-3 font-medium">Lesson stored</th>
                <th className="px-4 py-3 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {MEMORY.map((m) => (
                <tr key={m.date + m.token} className="border-b last:border-b-0">
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
                  <td className="max-w-64 px-4 py-3 text-muted-foreground">
                    {m.cause}
                  </td>
                  <td className="max-w-64 px-4 py-3">{m.lesson}</td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                        m.status === "Applied"
                          ? "bg-accent/10 text-accent"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {m.status === "Learning" && (
                        <span className="inline-block size-1.5 animate-blink rounded-full bg-current" />
                      )}
                      {m.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
