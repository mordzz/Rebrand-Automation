"use client";

import { Bot, Layers, Rocket, ShieldAlert, Target, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatSignedNative } from "@/components/dashboard/trade-history-table";
import { formatNative, nativeSymbolFor, rowSize } from "@/lib/chain/display";
import { cn } from "@/lib/utils";

import { AgentDetailModal } from "./agent-detail-modal";
import { formatMarketCap } from "@/lib/sniper/market-cap";

export type OpenPositionDto = {
  id: string;
  token: string;
  symbol: string | null;
  strategy: string;
  entryPrice: string;
  sizeSol: string;
  /** PR04 neutral size + chain — pick the unit per position (PR14). */
  sizeNative?: string | null;
  chain?: string | null;
  lastPrice: string | null;
  openedAt: string;
  /** USD market cap at entry and now. Null when supply or the native price
   *  could not be read; the display shows a dash rather than a guess. */
  entryMarketCapUsd: number | null;
  currentMarketCapUsd: number | null;
};

export type AgentDto = {
  id: string;
  name: string;
  characterType: "3d" | "image" | "gif";
  characterSrc: string | null;
  walletShort: string;
  deployedAt: string;
  /** The operator's own on/off switch — distinct from tradingPaused
   * (the safety circuit breaker) below. Stopped means the operator chose
   * to stop it; paused means it wants to trade but tripped a loss limit. */
  active: boolean;
  /** "paper" | "live". Paper means simulated fills; live means the agent
   * wallet is spending real ETH. */
  tradingMode: "paper" | "live";
  tradingPaused: boolean;
  pauseReason: string | null;
  /** Robinhood realized PnL, last 24h, in `nativeSymbol` (ETH). */
  pnl24hNative: number;
  nativeSymbol: string;
  winRate30d: number | null;
  trades30dCount: number;
  /** The agent wallet balance in `nativeSymbol` — only populated for live
   * bots, null for paper (no wallet to read). */
  agentBalanceNative: number | null;
  openPositions: OpenPositionDto[];
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

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/** A light, static thumbnail — the fleet view can render many agents at
 * once, so mounting one live CharacterCanvas (the 3D rig used on /deploy)
 * per card would be needlessly heavy. Image/GIF characters are cheap
 * either way and render for real. */
function AgentThumbnail({
  characterType,
  characterSrc,
}: {
  characterType: AgentDto["characterType"];
  characterSrc: string | null;
}) {
  if (characterType !== "3d" && characterSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={characterSrc}
        alt=""
        className="size-full rounded-xl object-cover"
      />
    );
  }
  return (
    <div className="flex size-full items-center justify-center rounded-xl bg-accent/10 text-accent">
      <Bot className="size-5" />
    </div>
  );
}

function PositionRow({ position }: { position: OpenPositionDto }) {
  const entry = Number(position.entryPrice);
  const last = position.lastPrice != null ? Number(position.lastPrice) : null;
  const changePct = last != null && entry > 0 ? ((last - entry) / entry) * 100 : null;

  return (
    <li className="flex items-center gap-3 border-t border-white/5 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {position.symbol ? `$${position.symbol}` : shortMint(position.token)}
          <span className="ml-2 font-normal text-muted-foreground">
            {position.strategy}
          </span>
        </p>
        <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
          {formatNative(rowSize(position), nativeSymbolFor(position), 4)} in at{" "}
          {formatMarketCap(position.entryMarketCapUsd)}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-xs font-medium tabular-nums",
          changePct == null && "text-muted-foreground",
          changePct != null && changePct > 0 && "text-sol-green-ink",
          changePct != null && changePct < 0 && "text-destructive"
        )}
      >
        {changePct != null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%` : "—"}
      </span>
    </li>
  );
}

function AgentCard({ agent, onOpen }: { agent: AgentDto; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer overflow-hidden rounded-2xl bg-card text-left transition-colors hover:bg-white/[0.03]"
    >
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="size-10 shrink-0">
          <AgentThumbnail
            characterType={agent.characterType}
            characterSrc={agent.characterSrc}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{agent.name}</p>
          <p className="truncate font-mono text-[0.7rem] text-muted-foreground">
            {agent.walletShort}
          </p>
        </div>
        {!agent.active ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[0.65rem] font-medium tracking-[0.1em] text-muted-foreground uppercase">
            <span className="inline-block size-1.5 rounded-full bg-muted-foreground/40" />
            Stopped
          </span>
        ) : agent.tradingPaused ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[0.65rem] font-medium tracking-[0.1em] text-destructive uppercase">
            <ShieldAlert className="size-3" />
            Paused
          </span>
        ) : agent.tradingMode === "live" ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-sol-green-ink/10 px-2.5 py-1 text-[0.65rem] font-medium tracking-[0.1em] text-sol-green-ink uppercase">
            <span className="inline-block size-1.5 animate-blink rounded-full bg-sol-green-ink" />
            Live
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[0.65rem] font-medium tracking-[0.1em] text-muted-foreground uppercase">
            <span className="inline-block size-1.5 animate-blink rounded-full bg-accent" />
            Paper
          </span>
        )}
      </div>

      {agent.active && agent.tradingPaused && agent.pauseReason && (
        <p className="border-t border-white/5 px-4 py-2 text-[0.7rem] text-destructive">
          Circuit breaker: {agent.pauseReason}
        </p>
      )}

      <div className={cn("grid gap-1 border-t border-white/5 p-1", agent.tradingMode === "live" ? "grid-cols-4" : "grid-cols-3")}>
        {agent.tradingMode === "live" && (
          <div className="rounded-xl bg-secondary px-3 py-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Wallet className="size-3" />
              <p className="text-[0.6rem] font-semibold tracking-[0.1em] uppercase">
                Balance
              </p>
            </div>
            <p className="mt-1.5 text-base font-medium tabular-nums">
              {agent.agentBalanceNative != null
                ? `${agent.agentBalanceNative.toFixed(4)} ${agent.nativeSymbol}`
                : "—"}
            </p>
          </div>
        )}
        <div className="rounded-xl bg-secondary px-3 py-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingUp className="size-3" />
            <p className="text-[0.6rem] font-semibold tracking-[0.1em] uppercase">
              PnL · 24h
            </p>
          </div>
          <p
            className={cn(
              "mt-1.5 text-base font-medium tabular-nums",
              agent.pnl24hNative > 0 && "text-sol-green-ink",
              agent.pnl24hNative < 0 && "text-destructive"
            )}
          >
            {formatSignedNative(agent.pnl24hNative, agent.nativeSymbol, 5)}
          </p>
        </div>
        <div className="rounded-xl bg-secondary px-3 py-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Target className="size-3" />
            <p className="text-[0.6rem] font-semibold tracking-[0.1em] uppercase">
              Win · 30d
            </p>
          </div>
          <p className="mt-1.5 text-base font-medium tabular-nums">
            {agent.winRate30d != null ? `${agent.winRate30d.toFixed(0)}%` : "—"}
          </p>
        </div>
        <div className="rounded-xl bg-secondary px-3 py-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Layers className="size-3" />
            <p className="text-[0.6rem] font-semibold tracking-[0.1em] uppercase">
              Open
            </p>
          </div>
          <p className="mt-1.5 text-base font-medium tabular-nums">
            {agent.openPositions.length}
          </p>
        </div>
      </div>

      {agent.openPositions.length > 0 && (
        <ul>
          {agent.openPositions.map((p) => (
            <PositionRow key={p.id} position={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Fleet, public directory — every deployed agent, its performance,
 * and its open positions. No wallet login required to view, same posture
 * as /alpha; deploying your own agent still happens on /deploy. */
export function AtelierFleet() {
  const response = usePolledJson<{ configured: boolean; agents: AgentDto[] }>(
    "/api/atelier",
    15_000
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (response && !response.configured) {
    return (
      <div className="rounded-2xl bg-card p-5 text-sm text-muted-foreground">
        Connect DATABASE_URL to see the fleet.
      </div>
    );
  }

  const agents = response?.agents ?? [];

  if (response && agents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-card px-8 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No agents deployed yet: be the first name in the fleet.
        </p>
        <Link
          href="/deploy"
          className="group bg-primary flex items-center gap-2 rounded-full py-2 pr-2 pl-5 text-sm font-medium text-black transition-all"
        >
          Deploy an agent
          <span className="flex size-7 items-center justify-center rounded-full bg-black text-[#E1E0CC] transition-transform group-hover:scale-110">
            <Rocket className="size-3.5" />
          </span>
        </Link>
      </div>
    );
  }

  const selected = agents.find((a) => a.id === selectedId) ?? null;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onOpen={() => setSelectedId(agent.id)} />
        ))}
      </div>
      {selected && (
        <AgentDetailModal agent={selected} onClose={() => setSelectedId(null)} />
      )}
    </>
  );
}
