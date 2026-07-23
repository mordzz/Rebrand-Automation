"use client";

import {
  Layers,
  Loader2,
  Pencil,
  Rocket,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import type { CharacterMood } from "@/components/dashboard/character-canvas";
import { ChatPanel, type ChatMessage } from "@/components/dashboard/chat-panel";
import { SniperConfigPanel } from "@/components/dashboard/sniper-config-panel";
import {
  TradeHistoryTable,
  formatSignedSol,
} from "@/components/dashboard/trade-history-table";
import {
  TradePerformanceChart,
  type TradeRow,
} from "@/components/dashboard/trade-performance-chart";
import { CharacterAvatar } from "@/components/deploy/character-avatar";
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
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        Connect a Solana wallet to get started. Your keys stay in your wallet —
        we only ever see your public address.
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

  const balanceCard: { value: string; hint: string; tone: Tone } =
    balance?.balanceSol != null
      ? {
          value: `${balance.balanceSol.toFixed(3)} SOL`,
          hint:
            balance.balanceUsd != null
              ? `≈ $${balance.balanceUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
              : "Live balance",
          // A freshly connected wallet legitimately has 0 SOL — that's
          // not a "positive" figure, just a fact, so it stays neutral.
          tone: balance.balanceSol > 0 ? "positive" : "muted",
        }
      : balance?.error
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
    { icon: Wallet, label: "SOL balance", ...balanceCard },
    { icon: Layers, label: "Open positions", ...openPositionsCard },
    { icon: TrendingUp, label: "PnL · 24h", colorValue: true, ...pnl24hCard },
    { icon: Target, label: "Win rate · 30d", colorValue: true, ...winRateCard },
  ];

  async function send(text: string) {
    setMessages((m) => [...m, { id: idRef.current++, role: "user", text }]);
    setThinking(true);
    setMood("thinking");

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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      {/* Left — the character panel, avatar top, chat below */}
      <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-card lg:col-span-2">
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
        <div className="flex h-[24rem] min-h-0 flex-col lg:h-auto lg:flex-1">
          <ChatPanel messages={messages} onSend={send} thinking={thinking} />
        </div>
      </div>

      {/* Right — status + private config */}
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
                <span className="inline-block size-1.5 animate-blink rounded-full bg-accent" />
                Paper Mode
              </span>
              <Button variant="ghost" size="sm" onClick={onEdit}>
                <Pencil className="mr-1.5 size-3.5" />
                Refit
              </Button>
            </div>
          </div>

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

        <SniperConfigPanel
          endpoint={`/api/my-bot/config?wallet=${encodeURIComponent(address)}`}
          title={`${bot.name} · Private Tune`}
          description="Your bot's own rules — seeded from the default configuration, yours to adjust."
        />
      </div>
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
