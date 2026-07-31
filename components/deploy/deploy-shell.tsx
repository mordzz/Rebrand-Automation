"use client";

import {
  AlertTriangle,
  Check,
  FlaskConical,
  Layers,
  Loader2,
  Pencil,
  Play,
  Rocket,
  Square,
  Target,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import type { CharacterMood } from "@/components/dashboard/character-canvas";
import { AgentMemory } from "@/components/dashboard/agent-memory";
import { ChatPanel, type ChatMessage } from "@/components/dashboard/chat-panel";
import { ExecutionTerminal } from "@/components/dashboard/execution-terminal";
import { SniperConfigPanel } from "@/components/dashboard/sniper-config-panel";
import {
  TradeHistoryTable,
  formatSignedSol,
} from "@/components/dashboard/trade-history-table";
import {
  TradePerformanceChart,
  type TradeRow,
} from "@/components/dashboard/trade-performance-chart";
import { AgentWalletPanel } from "@/components/deploy/agent-wallet-panel";
import { FundingModal } from "@/components/deploy/funding-modal";
import { GoLiveModal } from "@/components/deploy/go-live-modal";
import { CharacterAvatar } from "@/components/deploy/character-avatar";
import { RpcPanel } from "@/components/deploy/rpc-panel";
import {
  CHARACTER_ROSTER,
  characterTypeForSrc,
} from "@/components/deploy/characters";
import { PRIVY_APP_ID } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PANEL_LABEL =
  "text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground";

type Tone = "positive" | "muted" | "negative";

type BotDto = {
  id: string;
  name: string;
  characterType: "3d" | "image" | "gif";
  characterSrc: string | null;
};

type AddressBalance = {
  address: string;
  balanceSol?: number;
  balanceUsd?: number;
  rpc?: string;
  error?: string;
};

type StatsResponse = {
  configured: boolean;
  openPositionsCount?: number;
  openPositionsInProfit?: number;
  pnl24hSol?: number;
  winRate30d?: number | null;
  trades30dCount?: number;
  wins30dCount?: number;
  active?: boolean;
  tradingMode?: "paper" | "live";
  tradingPaused?: boolean;
  pauseReason?: string | null;
};

type DryRunTokenResult = {
  token: string;
  symbol: string;
  name: string;
  ageSec: number;
  passed: boolean;
  reasons: string[];
};

type DryRunResponse = {
  configured: boolean;
  tokensSeen: number;
  tokensEvaluated: number;
  passedCount: number;
  results: DryRunTokenResult[];
  error?: string;
};

/** Live on-chain balance for the connected wallet — a public address
 * lookup, no signing involved, safe to poll from the client. */
function useAddressBalance(address: string): AddressBalance | null {
  const [balance, setBalance] = useState<AddressBalance | null>(null);
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/wallet/balance?address=${encodeURIComponent(address)}`,
        );
        const json = (await res.json()) as AddressBalance;
        if (!disposed) setBalance(json);
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
  }, [address]);
  return balance;
}

/** Polls a JSON API on a 30s interval; keeps the last good value on a
 * transient fetch failure rather than blanking the UI. */
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

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/* ── Setup notice — shown until NEXT_PUBLIC_PRIVY_APP_ID exists ────────── */

function SetupNotice() {
  return (
    <div className="rounded-2xl bg-card p-8">
      <p className={PANEL_LABEL}>Login · Setup Required</p>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Wallet login is powered by Privy, but no app is configured yet. Create a
        free app at{" "}
        <a
          href="https://dashboard.privy.io"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          dashboard.privy.io
        </a>
        , then add its App ID to <code className="font-mono">.env</code> as{" "}
        <code className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</code> and restart
        the dev server. The login button will come alive on its own.
      </p>
    </div>
  );
}

/* ── Login gate ────────────────────────────────────────────────────────── */

function CredentialsGate({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-card px-8 py-16 text-center">
      <p className="flex items-center justify-center gap-3 text-xs font-semibold tracking-[0.25em] uppercase text-accent">
        <span className="h-px w-6 bg-accent/60" />
        Step One
        <span className="h-px w-6 bg-accent/60" />
      </p>
      <h2 className="mt-4 text-3xl font-medium tracking-tight">
        Present Your Credentials
      </h2>
      {/* Whitepaper §7.1 / Appendix D.15: this wallet establishes ownership
          only. The agent trades from a generated wallet of its own, whose key
          the platform does hold, so "we only ever see your public address"
          would be false the moment that agent is funded. */}
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        Connect a Solana wallet to get started. It establishes who owns the
        agent, and nothing more. Your keys and seed phrase are never requested,
        held, or delegated.
      </p>
      <Button size="lg" onClick={onLogin} className="mt-8 h-11 px-8">
        <Wallet className="mr-2 size-4" />
        Connect wallet
      </Button>
    </div>
  );
}

/* ── Character picker + naming form ────────────────────────────────────── */

function CharacterForm({
  address,
  initial,
  onDone,
  onCancel,
}: {
  address: string;
  initial: BotDto | null;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const initialRosterId =
    initial == null
      ? "noah"
      : (CHARACTER_ROSTER.find(
          (r) => r.src === initial.characterSrc && r.kind !== "3d",
        )?.id ?? (initial.characterType === "3d" ? "noah" : "custom"));

  const [name, setName] = useState(initial?.name ?? "");
  const [selected, setSelected] = useState<string>(initialRosterId);
  const [customUrl, setCustomUrl] = useState(
    initialRosterId === "custom" ? (initial?.characterSrc ?? "") : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customValid =
    /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(
      customUrl.trim(),
    );

  async function deploy() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Give your automaton a name (at least 2 characters).");
      return;
    }
    const roster = CHARACTER_ROSTER.find((r) => r.id === selected);
    const payload =
      selected === "custom"
        ? {
            characterType: characterTypeForSrc(customUrl.trim()),
            characterSrc: customUrl.trim(),
          }
        : roster?.kind === "3d"
          ? { characterType: "3d", characterSrc: null }
          : { characterType: "image", characterSrc: roster?.src ?? null };

    if (selected === "custom" && !customValid) {
      setError("Paste a direct image URL (png, jpg, gif, webp, or svg).");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/my-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, name: trimmed, ...payload }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Deploy failed — try again.");
        return;
      }
      onDone();
    } catch {
      setError("Connection trouble — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className={PANEL_LABEL}>
            {initial ? "Edit Your Bot" : "Set Up Your Bot"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose a face and a name — images, GIFs, or the Noah 3D bot.
          </p>
        </div>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      <div className="p-5">
        <div className="max-w-sm space-y-2">
          <Label className="text-sm font-normal">Name</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. The Baron, Snacks, Unit 7…"
            maxLength={40}
            className="w-full rounded-lg bg-secondary px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        <p className="mt-6 text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
          Character
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CHARACTER_ROSTER.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelected(entry.id)}
              className={cn(
                "overflow-hidden rounded-2xl text-left transition-colors",
                selected === entry.id
                  ? "bg-secondary ring-2 ring-primary"
                  : "bg-card hover:bg-secondary",
              )}
            >
              <div className="relative aspect-square">
                <CharacterAvatar
                  kind={entry.kind}
                  src={entry.src}
                  mood={selected === entry.id ? "talking" : "idle"}
                />
              </div>
              <div className="px-3.5 py-3">
                <p className="text-base font-medium">
                  {entry.name}
                  {entry.kind === "3d" && (
                    <span className="ml-2 text-[0.6rem] font-sans font-semibold tracking-[0.12em] uppercase text-accent">
                      3D
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {entry.blurb}
                </p>
              </div>
            </button>
          ))}

          {/* Custom image / GIF */}
          <button
            type="button"
            onClick={() => setSelected("custom")}
            className={cn(
              "overflow-hidden rounded-2xl text-left transition-colors",
              selected === "custom"
                ? "bg-secondary ring-2 ring-primary"
                : "bg-card hover:bg-secondary",
            )}
          >
            <div className="relative aspect-square">
              {customValid ? (
                <CharacterAvatar
                  kind="image"
                  src={customUrl.trim()}
                  mood={selected === "custom" ? "talking" : "idle"}
                />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  Paste an image or GIF URL below
                </div>
              )}
            </div>
            <div className="px-3.5 py-3">
              <p className="text-base font-medium">
                Your Own
                <span className="ml-2 text-[0.6rem] font-sans font-semibold tracking-[0.12em] uppercase text-accent">
                  IMG · GIF
                </span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Bring any face — a PFP, a GIF, a family portrait.
              </p>
            </div>
          </button>
        </div>

        {selected === "custom" && (
          <div className="mt-4 max-w-xl space-y-2">
            <Label className="text-sm font-normal">Image or GIF URL</Label>
            <input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://…/character.gif"
              className="w-full rounded-lg bg-secondary px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        )}

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <div className="mt-6 flex items-center gap-3 pt-5">
          <Button onClick={deploy} disabled={saving} className="h-10 px-6">
            {saving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Rocket className="mr-2 size-4" />
            )}
            {initial ? "Save changes" : "Deploy bot"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Paper mode — it trades on paper before it ever spends a lamport.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── The deployed bot's desk ───────────────────────────────────────────── */

function BotDesk({
  address,
  bot,
  onEdit,
}: {
  address: string;
  bot: BotDto;
  onEdit: () => void;
}) {
  const [mood, setMood] = useState<CharacterMood>("idle");
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "assistant",
      text: `${bot.name} reporting for duty. I'm in paper mode — studying the market, spending nothing. How can I help?`,
    },
  ]);
  const idRef = useRef(1);
  const balance = useAddressBalance(address);

  /* This account's own desk data — every endpoint below is scoped to
     `address` server-side (walletAddress on trades/positions), so it's a
     separate ledger from the shared house desk the dashboard reads, not
     a filtered view of the same rows. A freshly deployed bot legitimately
     starts empty until it closes its own trades. */
  const walletQuery = `wallet=${encodeURIComponent(address)}`;
  const statsData = usePolledJson<StatsResponse>(`/api/stats?${walletQuery}`);
  const tradesData = usePolledJson<{ configured: boolean; data: TradeRow[] }>(
    `/api/trades?${walletQuery}`,
  );
  const historyRows = tradesData?.data ?? [];

  // The paper daemon derives this bot's pause state fresh from its own
  // trade history (lib/sniper/risk-limits.ts#deriveTradingPause) — a bot
  // whose opening trades trip the loss-streak limit can never earn the win
  // that would clear it on its own, since a paused bot can't trade. Reset
  // clears it manually; the daemon picks the change up on its next roster
  // refresh (well within the stat panel's own 30s poll).
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  async function resetBreaker() {
    setResetting(true);
    setResetMessage(null);
    try {
      const res = await fetch(`/api/my-bot/reset-breaker?${walletQuery}`, { method: "POST" });
      setResetMessage(
        res.ok ? "Reset — trading resumes within moments." : "Reset failed, try again.",
      );
    } catch {
      setResetMessage("Reset failed, try again.");
    } finally {
      setResetting(false);
    }
  }

  // The operator's own on/off switch (app/api/my-bot/toggle) — a bot is
  // configured but inactive right after deploying, so nothing trades until
  // this is switched on. Once active, the standalone paper-daemon process
  // is what keeps it running, not this browser tab or this web server —
  // closing /deploy (or the whole browser) has no effect on it.
  //
  // statsData only refreshes every 30s (usePolledJson), so without an
  // optimistic override the Start/Stop button would look unresponsive for
  // up to half a minute after every click. Cleared during render (React's
  // documented "adjust state while rendering" pattern, not an effect) the
  // moment a poll confirms the server agrees, so statsData stays the
  // single source of truth as soon as it catches up.
  const [activeOverride, setActiveOverride] = useState<boolean | null>(null);
  const [lastSeenActive, setLastSeenActive] = useState(statsData?.active);
  if (statsData?.active !== lastSeenActive) {
    setLastSeenActive(statsData?.active);
    if (statsData?.active !== undefined && statsData.active === activeOverride) {
      setActiveOverride(null);
    }
  }
  const active = activeOverride ?? statsData?.active ?? false;

  const [toggling, setToggling] = useState(false);
  async function setBotActive(next: boolean) {
    setToggling(true);
    setActiveOverride(next);
    try {
      await fetch(`/api/my-bot/toggle?${walletQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
    } catch {
      setActiveOverride(null);
    } finally {
      setToggling(false);
    }
  }

  /* Paper vs live. Kept apart from Start/Stop deliberately: Start says the
     bot may trade, this says whether those trades spend real money. */
  const tradingMode = statsData?.tradingMode ?? "paper";

  /* Funding state, so a live bot that cannot afford a trade says so
     instead of silently passing on every candidate. */
  const walletData = usePolledJson<{
    wallet: {
      address: string;
      balanceSol: number | null;
      requiredSol: number;
      sizeSol: number;
      sufficient: boolean | null;
    } | null;
  }>(`/api/my-bot/wallet?${walletQuery}`);
  const [fundingDismissed, setFundingDismissed] = useState(false);
  /* Raised when a *paper* bot is refused the switch to live for lack of
     funds. Without it the modal could only ever appear for bots already
     live, which is the one case the mode gate already prevents. */
  const [fundingForced, setFundingForced] = useState(false);
  const agentWallet = walletData?.wallet ?? null;
  const needsFunding =
    agentWallet != null &&
    agentWallet.sufficient === false &&
    !fundingDismissed &&
    (tradingMode === "live" || fundingForced);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  /* Going live asks first, in a modal that shows the actual balance and
     position size. Going back to paper doesn't — it only ever reduces
     what the agent can do. */
  const [goLiveOpen, setGoLiveOpen] = useState(false);

  function requestMode(next: "paper" | "live") {
    if (next === "live") {
      setModeError(null);
      /* Already known to be underfunded: skip the confirmation and go
         straight to the fix, rather than walking the operator through a
         consent step the server is about to refuse anyway. */
      if (agentWallet?.sufficient === false) {
        setFundingForced(true);
        setFundingDismissed(false);
        return;
      }
      setGoLiveOpen(true);
      return;
    }
    void setMode("paper");
  }

  async function setMode(next: "paper" | "live") {
    setModeBusy(true);
    setModeError(null);
    try {
      const res = await fetch(`/api/my-bot/mode?${walletQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const json = await res.json();
      if (res.ok) {
        setGoLiveOpen(false);
      } else {
        setModeError(json.error ?? "Could not switch mode.");
        // Underfunded is the one failure with an obvious next action, so
        // answer it with the funding modal rather than a line of red text.
        if (json.needsFunding) {
          // Hand off, don't stack: the funding modal replaces the
          // confirmation rather than appearing on top of it.
          setGoLiveOpen(false);
          setFundingForced(true);
          setFundingDismissed(false);
        }
      }
    } catch {
      setModeError("Could not switch mode.");
    } finally {
      setModeBusy(false);
    }
  }

  // One-shot config test: listens to the real live pump.fun stream for
  // ~15-25s and grades everything it saw against this bot's own config,
  // using the exact same check the daemon runs — no position is ever
  // opened, nothing is written to positions/trades. Distinct from
  // Start/Stop: this doesn't touch `active` and doesn't need it on.
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResponse | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  async function runDryRun() {
    setDryRunning(true);
    setDryRunError(null);
    setDryRunResult(null);
    try {
      const res = await fetch(`/api/my-bot/dry-run?${walletQuery}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Dry run failed");
      setDryRunResult(json);
    } catch {
      setDryRunError("Dry run failed, try again.");
    } finally {
      setDryRunning(false);
    }
  }

  /* The balance that matters on the deploy page is always the agent
     wallet's — it's the bot's own trading wallet, whether paper or live.
     The operator's Phantom wallet is only used for identity; its balance
     is irrelevant here. Fall back to the operator wallet only when no
     agent wallet has been generated yet (pre-deploy state). */
  const agentBal = agentWallet?.balanceSol;
  const hasAgentWallet = agentWallet != null;
  const effectiveSol = hasAgentWallet ? agentBal : balance?.balanceSol;
  const effectiveUsd = hasAgentWallet ? null : balance?.balanceUsd;
  const effectiveError = hasAgentWallet ? null : balance?.error;

  const balanceCard: { value: string; hint: string; tone: Tone } =
    effectiveSol != null
      ? {
          value: `${effectiveSol.toFixed(3)} SOL`,
          hint:
            effectiveUsd != null
              ? `≈ $${effectiveUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
              : "Agent wallet",
          tone: effectiveSol > 0 ? "positive" : "muted",
        }
      : effectiveError
        ? {
            value: "—",
            hint: "RPC unavailable — try again shortly",
            tone: "muted",
          }
        : { value: "—", hint: "Loading…", tone: "muted" };

  const openPositionsCard: { value: string; hint: string; tone: Tone } =
    statsData?.configured
      ? {
          value: String(statsData.openPositionsCount ?? 0),
          hint: `${statsData.openPositionsInProfit ?? 0} in profit`,
          tone:
            (statsData.openPositionsInProfit ?? 0) > 0 ? "positive" : "muted",
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
          hint: statsData?.configured
            ? "No trades yet"
            : "Connect DATABASE_URL",
          tone: "muted",
        };

  const stats: {
    icon: typeof Wallet;
    label: string;
    value: string;
    hint: string;
    tone: Tone;
    colorValue?: boolean;
  }[] = [
    { icon: Wallet, label: "Agent balance", ...balanceCard },
    { icon: Layers, label: "Open positions", ...openPositionsCard },
    { icon: TrendingUp, label: "PnL · 24h", colorValue: true, ...pnl24hCard },
    { icon: Target, label: "Win rate · 30d", colorValue: true, ...winRateCard },
  ];

  async function send(text: string) {
    setMessages((m) => [...m, { id: idRef.current++, role: "user", text }]);
    setThinking(true);
    setMood("thinking");

    /* Build the message window for the per-agent chat route (stateless —
       it needs the conversation each time, same as the atelier modal). */
    const outgoing = [
      ...messages
        .filter((m) => m.id !== 0) // drop the static greeting
        .map((m) => ({ role: m.role, text: m.text })),
      { role: "user" as const, text },
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch("/api/atelier/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId: bot.id, messages: outgoing }),
        signal: controller.signal,
      });
      const json = await res.json();
      setMessages((m) => [
        ...m,
        { id: idRef.current++, role: "assistant", text: json.reply ?? "…" },
      ]);
      setMood("talking");
      setTimeout(() => setMood("idle"), 2200);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: idRef.current++,
          role: "assistant",
          text: "Connection trouble — try again.",
        },
      ]);
      setMood("idle");
    } finally {
      clearTimeout(timeout);
      setThinking(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Top: the agent on the left, how it's trading on the right.
          items-start stops the grid stretching the left column to match
          the right one — that stretch is what made the chat run the full
          height of the page. Bounded and sticky, it stays in view while
          the performance column scrolls past it instead. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5 lg:items-start">
        {/* Left — the character panel, avatar top, chat below */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-card lg:sticky lg:top-24 lg:col-span-2">
          <div className="flex items-center justify-between px-4 py-3">
            <p className={PANEL_LABEL}>{bot.name} · Your Bot</p>
            <span className="flex items-center gap-1.5 text-[0.7rem] font-medium tracking-[0.15em] uppercase text-muted-foreground">
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  mood === "idle" ? "bg-sol-green" : "bg-accent animate-blink",
                )}
              />
              {mood}
            </span>
          </div>
          <div className="relative aspect-[4/3] shrink-0">
            <CharacterAvatar
              kind={bot.characterType}
              src={bot.characterSrc}
              mood={mood}
            />
          </div>
          <div className="flex h-[22rem] min-h-0 shrink-0 flex-col">
            <ChatPanel messages={messages} onSend={send} thinking={thinking} />
          </div>
        </div>

        {/* Right — how it's trading: status, sizing, chart, ledger, console */}
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-3">
          {/* Wallet status bar + stat cells + performance chart in one flat
              panel — the dashboard's desk-panel rhythm, for this account. */}
          <div className="overflow-hidden rounded-2xl bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Wallet className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-sm">
                  {shortAddress(address)}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[0.7rem] font-medium tracking-[0.15em] uppercase text-muted-foreground">
                  <span className="inline-block size-1.5 rounded-full bg-accent" />
                  Paper Mode
                </span>
                <Button variant="ghost" size="sm" onClick={onEdit}>
                  <Pencil className="mr-1.5 size-3.5" />
                  Refit
                </Button>
              </div>
            </div>

            {/* Start/Stop — the master switch. A freshly deployed bot is
                inactive until this is switched on; once on, the standalone
                paper-daemon process keeps it running independent of this
                tab, this browser, or this web server. */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 px-4 py-3.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    "inline-block size-2 shrink-0 rounded-full",
                    active ? "bg-sol-green animate-blink" : "bg-muted-foreground/40"
                  )}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{active ? "Running" : "Stopped"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {active
                      ? "Trading continuously on our servers. Closing this tab won't stop it."
                      : "Not trading right now. Start it and it keeps running even after you leave."}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={runDryRun}
                  disabled={dryRunning}
                >
                  {dryRunning ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <FlaskConical className="mr-1.5 size-3.5" />
                  )}
                  {dryRunning ? "Testing…" : "Dry Run"}
                </Button>
                <Button
                  variant={active ? "outline" : "default"}
                  size="sm"
                  onClick={() => setBotActive(!active)}
                  disabled={toggling}
                >
                  {toggling ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : active ? (
                    <Square className="mr-1.5 size-3.5" />
                  ) : (
                    <Play className="mr-1.5 size-3.5" />
                  )}
                  {active ? "Stop" : "Start"}
                </Button>
              </div>
            </div>

            {/* Mode. Live is a separate, deliberate switch — not a side
              effect of Start. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {tradingMode === "live" ? "Live trading" : "Paper trading"}
              </p>
              <p className="text-xs text-muted-foreground">
                {tradingMode === "live"
                  ? "Spending real SOL from the agent wallet. Trades are irreversible."
                  : "Simulated fills. No real funds move."}
              </p>
              {modeError && (
                <p className="text-destructive mt-1 text-xs">{modeError}</p>
              )}
            </div>
            <div className="flex items-center gap-1 rounded-full bg-secondary p-1">
              {(["paper", "live"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={modeBusy}
                  onClick={() => requestMode(m)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                    tradingMode === m
                      ? m === "live"
                        ? "bg-destructive text-white"
                        : "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "paper" ? "Paper" : "Live"}
                </button>
              ))}
            </div>
          </div>

          {(dryRunning || dryRunResult || dryRunError) && (
              <div className="border-t border-white/5 px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[0.7rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
                    Dry run: live config test, nothing opened
                  </p>
                  {dryRunResult && (
                    <span className="text-xs text-muted-foreground">
                      {dryRunResult.passedCount} of {dryRunResult.tokensEvaluated} would have passed
                    </span>
                  )}
                </div>

                {dryRunning && (
                  <p className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Watching the live pump.fun stream and grading what comes in: this takes about 20-30 seconds.
                  </p>
                )}

                {dryRunError && (
                  <p className="mt-2.5 text-xs text-destructive">{dryRunError}</p>
                )}

                {dryRunResult && dryRunResult.tokensEvaluated === 0 && (
                  <p className="mt-2.5 text-xs text-muted-foreground">
                    No new tokens came through during the test window — try again in a moment.
                  </p>
                )}

                {dryRunResult && dryRunResult.results.length > 0 && (
                  <ul className="mt-2.5 max-h-64 space-y-1 overflow-y-auto">
                    {dryRunResult.results.map((r) => (
                      <li
                        key={r.token}
                        className="flex items-start gap-2.5 rounded-lg bg-secondary px-3 py-2"
                      >
                        {r.passed ? (
                          <Check className="mt-0.5 size-3.5 shrink-0 text-sol-green-ink" />
                        ) : (
                          <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">
                            ${r.symbol || "?"}
                            <span className="ml-2 font-normal text-muted-foreground">
                              {r.ageSec.toFixed(0)}s old
                            </span>
                          </p>
                          {!r.passed && r.reasons.length > 0 && (
                            <p className="mt-0.5 truncate text-[0.7rem] text-muted-foreground">
                              {r.reasons.join("; ")}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {statsData?.tradingPaused && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 px-4 py-2.5 text-xs text-destructive">
                <span className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Circuit breaker tripped: {statsData.pauseReason ?? "trading paused"}
                </span>
                <div className="flex items-center gap-2">
                  {resetMessage && (
                    <span className="text-[0.7rem] text-muted-foreground">{resetMessage}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetBreaker}
                    disabled={resetting}
                    className="h-7 px-2.5 text-destructive hover:text-destructive"
                  >
                    {resetting ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : null}
                    Reset breaker
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-1 p-1 pt-0 xl:grid-cols-4">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl bg-secondary px-4 py-4"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <stat.icon className="size-3.5" />
                    <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase">
                      {stat.label}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "mt-2.5 text-2xl font-medium tabular-nums",
                      stat.colorValue &&
                        stat.tone === "positive" &&
                        "text-sol-green-ink",
                      stat.colorValue &&
                        stat.tone === "negative" &&
                        "text-destructive",
                    )}
                  >
                    {stat.value}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      stat.tone === "positive" && "text-sol-green-ink",
                      stat.tone === "negative" && "text-destructive",
                      stat.tone === "muted" && "text-muted-foreground",
                    )}
                  >
                    {stat.hint}
                  </p>
                </div>
              ))}
            </div>

            <TradePerformanceChart
              trades={historyRows}
              configured={!!tradesData?.configured}
            />
          </div>

          {/* Trade history — same closed-trade ledger as the dashboard */}
          <div className="overflow-hidden rounded-2xl bg-card">
            <div className="px-4 py-3">
              <p className={PANEL_LABEL}>Trade History</p>
            </div>
            <div className="overflow-x-auto">
              <TradeHistoryTable
                trades={historyRows}
                configured={!!tradesData?.configured}
              />
            </div>
          </div>

          {/* Console lives with performance rather than below: it is the
              live half of the same story the chart and ledger tell after
              the fact. Wallet-scoped — the dashboard's terminal reads the
              same table unfiltered, so `?wallet=` is what keeps them apart. */}
          <div className="overflow-hidden rounded-2xl bg-card">
            <div className="px-4 py-3">
              <p className={PANEL_LABEL}>Console</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Every fill, exit and guard trip, oldest first. Paper trades
                never broadcast a transaction, so each line links to the
                token rather than to a signature.
              </p>
            </div>
            {/* Activity, not raw logs: it folds in closed trades that
                pre-date per-bot logging, so history is visible too. */}
            <ExecutionTerminal endpoint={`/api/my-bot/activity?${walletQuery}`} />
          </div>
        </div>
      </div>

      {/* Full-width below: what the agent has learned, and the rules it
          runs on. Both want the whole width — the config panel lays its
          fields out in two columns of its own, and halving it would just
          make it twice as tall. */}
      <AgentMemory
        endpoint={`/api/lessons?${walletQuery}`}
        emptyHint="No lessons yet — the first losing trade gets a written post-mortem here."
      />

      <AgentWalletPanel walletQuery={walletQuery} ownerAddress={address} />

      {goLiveOpen && (
        <GoLiveModal
          balanceSol={agentWallet?.balanceSol ?? null}
          sizeSol={agentWallet?.sizeSol ?? null}
          address={agentWallet?.address ?? null}
          busy={modeBusy}
          onConfirm={() => void setMode("live")}
          onCancel={() => setGoLiveOpen(false)}
        />
      )}

      {needsFunding && agentWallet && (
        <FundingModal
          address={agentWallet.address}
          balanceSol={agentWallet.balanceSol ?? 0}
          requiredSol={agentWallet.requiredSol}
          onClose={() => {
            setFundingDismissed(true);
            setFundingForced(false);
          }}
        />
      )}

      <RpcPanel walletQuery={walletQuery} />

      <SniperConfigPanel
        endpoint={`/api/my-bot/config?wallet=${encodeURIComponent(address)}`}
        title={`${bot.name} · Private Tune`}
        description="Your bot's own rules — seeded from the default configuration, yours to adjust."
      />
    </div>
  );
}

/* ── Authenticated flow ────────────────────────────────────────────────── */

function DeployInner() {
  const { ready, authenticated, user, login } = usePrivy();
  const address = user?.wallet?.address ?? null;

  /* Keyed by the address the fetch was for — switching wallets naturally
     reads as "not loaded yet" without a synchronous state reset. Bumping
     refreshTick refetches (after deploy/refit). */
  const [botState, setBotState] = useState<{
    address: string;
    bot: BotDto | null;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = () => setRefreshTick((t) => t + 1);

  useEffect(() => {
    if (!authenticated || !address) return;
    let disposed = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/my-bot?wallet=${encodeURIComponent(address!)}`,
        );
        const json = await res.json();
        if (!disposed)
          setBotState({ address: address!, bot: json.bot ?? null });
      } catch {
        if (!disposed) setBotState({ address: address!, bot: null });
      }
    }
    load();
    return () => {
      disposed = true;
    };
  }, [authenticated, address, refreshTick]);

  const loaded = botState?.address === address;
  const bot = loaded ? botState.bot : null;

  if (!ready) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Preparing your session…
      </div>
    );
  }

  if (!authenticated || !address) {
    return <CredentialsGate onLogin={() => login()} />;
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Checking for your bot…
      </div>
    );
  }

  if (!bot || editing) {
    return (
      <CharacterForm
        address={address}
        initial={bot}
        onDone={() => {
          setEditing(false);
          refresh();
        }}
        onCancel={
          bot
            ? () => {
                setEditing(false);
              }
            : undefined
        }
      />
    );
  }

  return (
    <BotDesk address={address} bot={bot} onEdit={() => setEditing(true)} />
  );
}

export function DeployShell() {
  if (!PRIVY_APP_ID) return <SetupNotice />;
  return <DeployInner />;
}
