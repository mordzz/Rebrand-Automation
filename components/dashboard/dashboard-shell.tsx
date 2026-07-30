"use client";

import { Check, Copy, Layers, Target, TrendingUp, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import type { CharacterMood } from "@/components/dashboard/character-canvas";
import { ChatPanel, type ChatMessage } from "@/components/dashboard/chat-panel";
import { LiveMints } from "@/components/dashboard/live-mints";
import { NewLaunches } from "@/components/dashboard/new-launches";
import { SniperConfigReadout } from "@/components/dashboard/sniper-config-readout";
import { SniperStatusPanel } from "@/components/dashboard/sniper-status-panel";
import {
  TradeHistoryTable,
  formatSignedSol,
} from "@/components/dashboard/trade-history-table";
import {
  TradePerformanceChart,
  type TradeRow,
} from "@/components/dashboard/trade-performance-chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatMarketCap } from "@/lib/sniper/market-cap";

const CharacterCanvas = dynamic(
  () =>
    import("@/components/dashboard/character-canvas").then(
      (m) => m.CharacterCanvas
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Waking the bot…
      </div>
    ),
  }
);

type Tone = "positive" | "muted" | "negative";

type WalletState = {
  connected: boolean;
  address?: string;
  balanceSol?: number;
  balanceUsd?: number;
  rpc?: string;
  error?: string;
};

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

type StatsResponse = {
  configured: boolean;
  openPositionsCount?: number;
  openPositionsInProfit?: number;
  pnl24hSol?: number;
  winRate30d?: number | null;
  trades30dCount?: number;
  wins30dCount?: number;
};

type PositionRow = {
  id: string;
  token: string;
  symbol: string | null;
  strategy: string;
  status: string;
  entryPrice: string;
  sizeSol: string;
  lastPrice: string | null;
  entryMarketCapUsd: number | null;
  currentMarketCapUsd: number | null;
};

/** Polls a JSON API on a 30s interval; keeps the last good value on a transient fetch failure rather than blanking the UI. */
function usePolledJson<T>(url: string): T | null {
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
    const interval = setInterval(load, 30_000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [url]);
  return data;
}

// The Raven is real and gets its own live-config panel below — these
// three remaining automatons aren't built yet, still placeholder rows.
const STRATEGIES = [
  { name: "The Wake", status: "Active", detail: "Mirroring 6 wallets · proportional sizing", trades: "9 trades this week" },
  { name: "The Ark", status: "Active", detail: "Guarding 8 positions · trailing 12%", trades: "3 exits this week" },
  { name: "The Tide", status: "Paused", detail: "Daily WIF ladder · resumes on -8% dip", trades: "4 buys this week" },
];

/** Shared micro-label style for panel headers — the desk's typographic signature. */
const PANEL_LABEL =
  "text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground";

const TABLE_HEAD =
  "px-4 py-3 text-[0.65rem] font-semibold tracking-[0.15em] uppercase";

export function DashboardShell() {
  const [mood, setMood] = useState<CharacterMood>("idle");
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "assistant",
      text: "Welcome back. Your bot kept working overnight — 3 trades closed, +2.3 SOL. How can I help?",
    },
  ]);
  const idRef = useRef(1);

  /* Live automation wallet — the private key stays server-side; this only
     ever receives the public address + balance from /api/wallet. */
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);

  async function copyAddress() {
    if (!wallet?.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const res = await fetch("/api/wallet");
        const json = (await res.json()) as WalletState;
        if (!disposed) setWallet(json);
      } catch {
        if (!disposed) setWallet({ connected: false });
      }
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, []);

  const walletCard: { value: string; hint: string; tone: Tone } =
    wallet?.connected && typeof wallet.balanceSol === "number"
      ? {
          value: `${wallet.balanceSol.toFixed(2)} SOL`,
          hint:
            typeof wallet.balanceUsd === "number"
              ? `≈ $${wallet.balanceUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
              : "Live balance",
          tone: "positive",
        }
      : wallet?.connected
        ? {
            value: "—",
            hint: "RPC unavailable — set SOLANA_RPC_URL",
            tone: "muted",
          }
        : {
            value: "42.7 SOL",
            hint: "Sample · set PRIVATE_KEY_SOLANA_WALLET",
            tone: "muted",
          };

  const statsData = usePolledJson<StatsResponse>("/api/stats");
  const positionsData = usePolledJson<{ configured: boolean; data: PositionRow[] }>(
    "/api/positions"
  );
  const tradesData = usePolledJson<{ configured: boolean; data: TradeRow[] }>(
    "/api/trades"
  );

  const openPositionsCard: { value: string; hint: string; tone: Tone } =
    statsData?.configured
      ? {
          value: String(statsData.openPositionsCount ?? 0),
          hint: `${statsData.openPositionsInProfit ?? 0} in profit`,
          tone: (statsData.openPositionsInProfit ?? 0) > 0 ? "positive" : "muted",
        }
      : { value: "—", hint: "Connect DATABASE_URL", tone: "muted" };

  const pnl24hCard: { value: string; hint: string; tone: Tone } =
    statsData?.configured
      ? {
          value: formatSignedSol(statsData.pnl24hSol ?? 0),
          hint: "Realized, last 24h",
          tone:
            (statsData.pnl24hSol ?? 0) > 0
              ? "positive"
              : (statsData.pnl24hSol ?? 0) < 0
                ? "negative"
                : "muted",
        }
      : { value: "—", hint: "Connect DATABASE_URL", tone: "muted" };

  const winRateCard: { value: string; hint: string; tone: Tone } =
    statsData?.configured && statsData.winRate30d != null
      ? {
          value: `${statsData.winRate30d.toFixed(0)}%`,
          hint: `${statsData.wins30dCount ?? 0} of ${statsData.trades30dCount ?? 0} trades`,
          tone: statsData.winRate30d >= 50 ? "positive" : "negative",
        }
      : {
          value: "—",
          hint: statsData?.configured ? "No trades yet" : "Connect DATABASE_URL",
          tone: "muted",
        };

  const stats: {
    icon: typeof Wallet;
    label: string;
    value: string;
    hint: string;
    tone: Tone;
    /** Tint the value itself, not just the hint — for gain/loss figures. */
    colorValue?: boolean;
  }[] = [
    { icon: Wallet, label: "Wallet balance", ...walletCard },
    { icon: Layers, label: "Open positions", ...openPositionsCard },
    { icon: TrendingUp, label: "PnL · 24h", colorValue: true, ...pnl24hCard },
    { icon: Target, label: "Win rate · 30d", colorValue: true, ...winRateCard },
  ];

  const openPositions = (positionsData?.data ?? []).filter(
    (p) => p.status === "open"
  );
  const historyRows = tradesData?.data ?? [];

  async function send(text: string) {
    const userMsg: ChatMessage = { id: idRef.current++, role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setThinking(true);
    setMood("thinking");

    // Free-tier model responses can take a while, but an unbounded fetch
    // can hang indefinitely on a dropped connection (e.g. the dev server
    // restarting mid-request) and permanently lock the input, since
    // `thinking` never resets without either a response or a rejection.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      const json = await res.json();
      setMessages((m) => [
        ...m,
        { id: idRef.current++, role: "assistant", text: json.reply },
      ]);
      setMood("talking");
      setTimeout(() => setMood("idle"), 2200);
    } catch (error) {
      setMessages((m) => [
        ...m,
        {
          id: idRef.current++,
          role: "assistant",
          text:
            error instanceof DOMException && error.name === "AbortError"
              ? "That's taking too long — try again in a moment."
              : "Connection trouble — try again.",
        },
      ]);
      setMood("idle");
    } finally {
      clearTimeout(timeout);
      setThinking(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      {/* Daemon health + circuit-breaker status — full width, above both columns */}
      <div className="lg:col-span-5">
        <SniperStatusPanel />
      </div>

      {/* Left column — one flat panel: automaton on top, concierge below */}
      <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-card lg:col-span-2">
        <div className="flex items-center justify-between px-4 py-3">
          <p className={PANEL_LABEL}>Your Bot · On Duty</p>
          <span className="flex items-center gap-1.5 text-[0.7rem] font-medium tracking-[0.15em] uppercase text-muted-foreground">
            <span
              className={cn(
                "inline-block size-1.5 rounded-full",
                mood === "idle" ? "bg-sol-green" : "bg-accent animate-blink"
              )}
            />
            {mood}
          </span>
        </div>
        <div className="relative aspect-[4/3] shrink-0">
          <CharacterCanvas mood={mood} />
        </div>
        <div className="flex h-[24rem] min-h-0 flex-col lg:h-auto lg:flex-1">
          <ChatPanel messages={messages} onSend={send} thinking={thinking} />
        </div>
      </div>

      {/* Right column — desk panel + tabs */}
      <div className="flex min-w-0 flex-col gap-5 lg:col-span-3">
        {/* The desk: wallet status bar + stat cells in one flat panel */}
        <div className="relative overflow-hidden rounded-2xl bg-card">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <Wallet className="size-4 shrink-0 text-muted-foreground" />
              {wallet?.connected && wallet.address ? (
                <>
                  <span className="truncate font-mono text-sm">
                    {shortAddress(wallet.address)}
                  </span>
                  <button
                    type="button"
                    onClick={copyAddress}
                    aria-label="Copy wallet address"
                    title="Copy address"
                    className="shrink-0 text-muted-foreground transition-colors hover:text-accent"
                  >
                    {copiedAddress ? (
                      <Check className="size-3.5 text-sol-green-ink" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                </>
              ) : (
                <span className="truncate text-sm text-muted-foreground">
                  No wallet configured
                </span>
              )}
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-[0.7rem] font-medium tracking-[0.15em] uppercase text-muted-foreground">
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  wallet == null
                    ? "bg-muted-foreground/40 animate-blink"
                    : wallet.connected
                      ? "bg-sol-green"
                      : "bg-muted-foreground/40"
                )}
              />
              {wallet == null ? (
                "Connecting…"
              ) : wallet.connected ? (
                <>
                  Connected
                  {wallet.rpc && (
                    <span className="hidden normal-case tracking-normal sm:inline">
                      {" "}
                      · {wallet.rpc}
                    </span>
                  )}
                </>
              ) : (
                "Not connected"
              )}
            </span>
          </div>

          {/* Stat cells as mini-cards — the landing features-grid rhythm */}
          <div className="grid grid-cols-2 gap-1 p-1 pt-0 xl:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-xl bg-secondary px-4 py-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <stat.icon className="size-3.5" />
                  <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase">
                    {stat.label}
                  </p>
                </div>
                <p
                  className={cn(
                    "mt-2.5 text-2xl font-medium tabular-nums",
                    stat.colorValue && stat.tone === "positive" && "text-sol-green-ink",
                    stat.colorValue && stat.tone === "negative" && "text-destructive"
                  )}
                >
                  {stat.value}
                </p>
                <p
                  className={cn(
                    "mt-1 text-xs",
                    stat.tone === "positive" && "text-sol-green-ink",
                    stat.tone === "negative" && "text-destructive",
                    stat.tone === "muted" && "text-muted-foreground"
                  )}
                >
                  {stat.hint}
                </p>
              </div>
            ))}
          </div>

          {/* Trade performance — per-trade realized P&L + cumulative curve */}
          <TradePerformanceChart
            trades={historyRows}
            configured={!!tradesData?.configured}
          />
        </div>

        <Tabs defaultValue="positions" className="min-w-0 flex-1 gap-4">
          <TabsList
            variant="line"
            className="h-auto w-full justify-start gap-6 rounded-none bg-transparent p-0"
          >
            {[
              { value: "positions", label: "Positions" },
              { value: "history", label: "History" },
              { value: "strategies", label: "Strategies" },
              { value: "mints", label: "Live Mints", live: true },
            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="h-auto flex-none px-0 pb-2.5 text-[0.7rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground after:-bottom-px after:h-px after:bg-accent hover:text-foreground data-active:text-accent"
              >
                {tab.live && (
                  <span className="mr-1.5 inline-block size-1.5 animate-blink rounded-full bg-accent" />
                )}
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="positions">
            <div className="overflow-x-auto rounded-2xl bg-card">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left text-muted-foreground">
                    <th className={TABLE_HEAD}>Token</th>
                    <th className={TABLE_HEAD}>Strategy</th>
                    <th className={TABLE_HEAD}>In at</th>
                    <th className={TABLE_HEAD}>Now</th>
                    <th className={TABLE_HEAD}>Size</th>
                    <th className={cn(TABLE_HEAD, "text-right")}>PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {!positionsData?.configured ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-sm text-muted-foreground"
                      >
                        Connect DATABASE_URL to track live positions.
                      </td>
                    </tr>
                  ) : openPositions.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-sm text-muted-foreground"
                      >
                        No open positions yet.
                      </td>
                    </tr>
                  ) : (
                    openPositions.map((p) => {
                      const entry = Number(p.entryPrice);
                      const mark = p.lastPrice != null ? Number(p.lastPrice) : null;
                      const pnlPct = mark != null ? ((mark - entry) / entry) * 100 : null;
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-white/5 transition-colors last:border-b-0 hover:bg-accent/[0.03]"
                        >
                          <td className="px-4 py-3 font-medium">
                            ${p.symbol ?? shortAddress(p.token)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {p.strategy}
                          </td>
                          {/* Market cap, not the e-8 per-token price: the
                              raw figure is unreadable and not comparable
                              between tokens with different supplies. */}
                          <td className="px-4 py-3 font-mono text-[0.8rem]">
                            {formatMarketCap(p.entryMarketCapUsd)}
                          </td>
                          <td className="px-4 py-3 font-mono text-[0.8rem]">
                            {formatMarketCap(p.currentMarketCapUsd)}
                          </td>
                          <td className="px-4 py-3 font-mono text-[0.8rem]">
                            {Number(p.sizeSol).toFixed(3)} SOL
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 text-right font-mono text-[0.8rem] font-medium",
                              pnlPct == null
                                ? "text-muted-foreground"
                                : pnlPct >= 0
                                  ? "text-sol-green-ink"
                                  : "text-destructive"
                            )}
                          >
                            {pnlPct != null
                              ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="overflow-x-auto rounded-2xl bg-card">
              <TradeHistoryTable
                trades={historyRows}
                configured={!!tradesData?.configured}
              />
            </div>
          </TabsContent>

          <TabsContent value="strategies">
            <SniperConfigReadout />
            {/* Remaining automatons — flat hairline list, not a card grid */}
            <div className="mt-4 overflow-hidden rounded-2xl bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className={PANEL_LABEL}>Other Automatons</p>
                <p className="text-xs text-muted-foreground">
                  Deploying your own automaton is coming soon.
                </p>
              </div>
              <ul className="divide-y divide-white/5">
                {STRATEGIES.map((s) => (
                  <li
                    key={s.name}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-accent/[0.03]"
                  >
                    <span className="flex w-32 shrink-0 items-center gap-2">
                      <span
                        className={cn(
                          "inline-block size-1.5 rounded-full",
                          s.status === "Active"
                            ? "bg-accent"
                            : "bg-muted-foreground/40"
                        )}
                      />
                      <span className="text-base font-medium">
                        {s.name}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                      {s.detail}
                    </span>
                    <span className="text-xs text-muted-foreground/70">
                      {s.trades}
                    </span>
                    <span
                      className={cn(
                        "w-14 text-right text-[0.65rem] font-semibold tracking-[0.15em] uppercase",
                        s.status === "Active"
                          ? "text-accent"
                          : "text-muted-foreground"
                      )}
                    >
                      {s.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </TabsContent>

          <TabsContent value="mints">
            {/* Two feeds, deliberately: LiveMints is the real-time pump.fun
                WebSocket the engine actually snipes from; NewLaunches is
                the wider multi-launchpad view (bags, believe, letsbonk,
                boop, moonshot, …) that PumpPortal alone cannot see. */}
            <div className="flex flex-col gap-5">
              <LiveMints />
              <NewLaunches />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
