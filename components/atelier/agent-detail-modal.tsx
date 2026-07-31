"use client";

import { AnimatePresence, motion } from "motion/react";
import { ShieldAlert, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CharacterAvatar } from "@/components/deploy/character-avatar";
import type { CharacterMood } from "@/components/dashboard/character-canvas";
import { ChatPanel, type ChatMessage } from "@/components/dashboard/chat-panel";
import { formatSignedSol } from "@/components/dashboard/trade-history-table";
import { cn } from "@/lib/utils";

import type { AgentDto } from "./atelier-fleet";
import { formatMarketCap } from "@/lib/sniper/market-cap";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function deployedFor(iso: string): string {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
  );
  if (days === 0) return "deployed today";
  if (days === 1) return "deployed 1 day ago";
  return `deployed ${days} days ago`;
}

function greeting(name: string): ChatMessage {
  return {
    id: 0,
    role: "assistant",
    text: `Hey, I'm ${name}. Ask me about my trades, my open positions, or how things have been going: I won't share my exact config, but I'll talk shop.`,
  };
}

/** Detail preview for one agent — performance and open positions only,
 * never its configuration (see the opacity note on lib/agent/agent-chat.ts
 * for why: this modal simply never fetches bot.config in the first
 * place). Includes a live chat with the agent itself, grounded in the
 * same performance data shown above it.
 *
 * The conversation lives only in this component's state. /atelier has no
 * visitor login, so a stored thread would be one transcript shared by
 * every visitor — each person reading the last person's questions.
 * Closing the modal ends the conversation. What persists is the agent's
 * own memory (its post-mortems and trade record), which is what the
 * replies are grounded in. */
export function AgentDetailModal({
  agent,
  onClose,
}: {
  agent: AgentDto;
  onClose: () => void;
}) {
  const [mood, setMood] = useState<CharacterMood>("idle");
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([greeting(agent.name)]);
  const idRef = useRef(1);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(text: string) {
    /* The route is stateless, so the conversation has to travel with the
       request. Built from the messages already on screen plus this turn —
       the greeting is dropped because the agent never actually said it. */
    const outgoing = [
      ...messages
        .filter((m) => m.id !== 0)
        .map((m) => ({ role: m.role, text: m.text })),
      { role: "user" as const, text },
    ];

    setMessages((m) => [...m, { id: idRef.current++, role: "user", text }]);
    setThinking(true);
    setMood("thinking");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch("/api/atelier/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId: agent.id, messages: outgoing }),
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
        { id: idRef.current++, role: "assistant", text: "Connection trouble, try again." },
      ]);
      setMood("idle");
    } finally {
      clearTimeout(timeout);
      setThinking(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      >
        <motion.div
          className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-y-auto overscroll-contain rounded-2xl bg-card lg:grid lg:h-[85vh] lg:max-h-[85vh] lg:grid-cols-5 lg:grid-rows-[minmax(0,1fr)] lg:overflow-y-hidden"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.25, ease: EASE }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Left — avatar, identity, chat */}
          <div className="order-2 flex flex-col lg:order-none lg:col-span-2 lg:min-h-0 lg:overflow-hidden lg:border-r lg:border-white/5">
            <div /* Definite heights, not aspect-ratio: CharacterAvatar's image branch
                 sizes itself with h-full, which against an aspect-ratio-derived
                 (indefinite) height resolves to the image's own size and pushes
                 the box past the ratio — measured 375px where 16/9 asked for
                 210px, eating half the dialog on a phone. overflow-hidden keeps
                 any character type inside whatever we allot. */
              className="relative h-40 shrink-0 overflow-hidden border-t border-white/5 sm:h-52 lg:h-auto lg:max-h-[38%] lg:min-h-[9rem] lg:flex-1 lg:border-t-0">
              <CharacterAvatar
                kind={agent.characterType}
                src={agent.characterSrc}
                mood={mood}
              />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute top-3 right-3 hidden size-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60 lg:flex"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex h-[26rem] min-h-0 flex-col sm:h-[28rem] lg:h-auto lg:min-h-0 lg:flex-1 lg:overflow-hidden">
              <ChatPanel
                messages={messages}
                onSend={send}
                thinking={thinking}
                title={`Ask ${agent.name}`}
                subtitle="Performance and reasoning only: configuration stays private."
                placeholder={`Ask ${agent.name}…`}
              />
            </div>
          </div>

          {/* Right — identity header, performance, open positions */}
          <div className="order-1 flex flex-col lg:order-none lg:col-span-3 lg:min-h-0 lg:overflow-y-auto">
            <div className="flex items-start justify-between gap-3 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <p className="truncate text-lg font-medium">{agent.name}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {agent.walletShort} · {deployedFor(agent.deployedAt)}
                </p>
              </div>
              {/* Below lg this pane comes first, so the avatar's overlay
                  close button is far down the page — this is the reachable
                  one there, and it steps aside once the avatar is visible. */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="order-last shrink-0 text-muted-foreground transition-colors hover:text-foreground lg:hidden"
              >
                <X className="size-4" />
              </button>
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
              <p className="border-t border-white/5 px-4 py-2.5 text-xs text-destructive sm:px-5">
                Circuit breaker: {agent.pauseReason}
              </p>
            )}

            <div className={cn("grid gap-1 border-t border-white/5 p-1", agent.tradingMode === "live" ? "grid-cols-4" : "grid-cols-3")}>
              {agent.tradingMode === "live" && (
                <div className="rounded-xl bg-secondary px-3 py-3 sm:px-4 sm:py-4">
                  <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
                    <Wallet className="mr-1 inline size-3" />
                    Balance
                  </p>
                  <p className="mt-2 text-lg font-medium tabular-nums sm:text-xl">
                    {agent.agentBalanceSol != null
                      ? `${agent.agentBalanceSol.toFixed(3)} SOL`
                      : "—"}
                  </p>
                </div>
              )}
              <div className="rounded-xl bg-secondary px-3 py-3 sm:px-4 sm:py-4">
                <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
                  PnL · 24h
                </p>
                <p
                  className={cn(
                    "mt-2 text-lg font-medium tabular-nums sm:text-xl",
                    agent.pnl24hSol > 0 && "text-sol-green-ink",
                    agent.pnl24hSol < 0 && "text-destructive"
                  )}
                >
                  {formatSignedSol(agent.pnl24hSol, 3)}
                </p>
              </div>
              <div className="rounded-xl bg-secondary px-3 py-3 sm:px-4 sm:py-4">
                <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
                  Win rate · 30d
                </p>
                <p className="mt-2 text-lg font-medium tabular-nums sm:text-xl">
                  {agent.winRate30d != null ? `${agent.winRate30d.toFixed(0)}%` : "—"}
                </p>
                <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
                  {agent.trades30dCount} trades
                </p>
              </div>
              <div className="rounded-xl bg-secondary px-3 py-3 sm:px-4 sm:py-4">
                <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
                  Open positions
                </p>
                <p className="mt-2 text-lg font-medium tabular-nums sm:text-xl">
                  {agent.openPositions.length}
                </p>
              </div>
            </div>

            <div className="border-t border-white/5 px-4 py-3 sm:px-5">
              <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
                Open positions
              </p>
            </div>
            {agent.openPositions.length === 0 ? (
              <p className="px-4 pb-6 text-sm text-muted-foreground sm:px-5">Nothing open right now.</p>
            ) : (
              <ul className="pb-2">
                {agent.openPositions.map((p) => {
                  const entry = Number(p.entryPrice);
                  const last = p.lastPrice != null ? Number(p.lastPrice) : null;
                  const changePct = last != null && entry > 0 ? ((last - entry) / entry) * 100 : null;
                  return (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 border-t border-white/5 px-4 py-3 sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {p.symbol ? `$${p.symbol}` : shortMint(p.token)}
                          <span className="ml-2 font-normal text-muted-foreground">
                            {p.strategy}
                          </span>
                        </p>
                        {/* Market cap, not a per-token price: 5.76e-8 SOL
                            tells a reader nothing about how early the entry
                            was, and cap is comparable across tokens. */}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {Number(p.sizeSol).toFixed(3)} SOL in at{" "}
                          <span className="text-foreground/80">
                            {formatMarketCap(p.entryMarketCapUsd)}
                          </span>
                          {p.currentMarketCapUsd != null && (
                            <> · now {formatMarketCap(p.currentMarketCapUsd)}</>
                          )}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-sm font-medium tabular-nums",
                          changePct == null && "text-muted-foreground",
                          changePct != null && changePct > 0 && "text-sol-green-ink",
                          changePct != null && changePct < 0 && "text-destructive"
                        )}
                      >
                        {changePct != null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%` : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
