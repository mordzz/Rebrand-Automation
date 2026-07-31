import { llmChat } from "@/lib/agent/llm";

export type AgentChatMessage = { role: "user" | "assistant"; text: string };

export type TradeRecord = {
  id: string;
  symbol: string;
  pnlSol: number;
  closedAt: string;
  cause: string | null;
  lessonStatus: "learning" | "applied" | null;
};

export type NotableTradeTag = "recent" | "biggest win" | "biggest loss" | "applied lesson";

export type NotableTrade = TradeRecord & { tags: NotableTradeTag[] };

/** One post-mortem this agent wrote about its own loss — its memory in
 * the literal sense the platform means it: not chat scrollback, but what
 * it concluded and whether it acted on it. */
export type AgentMemory = {
  symbol: string | null;
  cause: string;
  lesson: string;
  status: "learning" | "applied";
  createdAt: string;
};

export type AgentChatContext = {
  name: string;
  /** 3d | image | gif — the form this agent wears on its profile. */
  characterType: string;
  deployedAt: string;
  tradingMode: "paper" | "live";
  tradingPaused: boolean;
  pauseReason: string | null;
  pnl24hSol: number;
  winRate30d: number | null;
  trades30dCount: number;
  /** The agent’s own trading wallet balance in SOL, or null if it
   * couldn’t be read. */
  agentBalanceSol: number | null;
  openPositions: {
    symbol: string | null;
    token: string;
    sizeSol: string;
    entryPrice: string;
    lastPrice: string | null;
    openedAt: string;
  }[];
  /** A bounded, hand-picked slice of trade history, not a raw "last N" —
   * see selectNotableTrades. This is what lets the same context stay
   * cheap and informative whether the agent has closed 3 trades or 3,000. */
  notableTrades: NotableTrade[];
  /** Most recent first, already bounded by the caller’s query. */
  memory: AgentMemory[];
};

const RECENT_COUNT = 3;
const APPLIED_LESSON_COUNT = 2;
const MAX_NOTABLE_TRADES = 8;

/**
 * Picks a small, bounded, labeled slice of a wallet's trade history for the
 * chat context: the most recent few (what a visitor asking "how's it
 * going" wants), the single biggest win and loss (what a visitor asking
 * "what happened" wants), and a couple of trades whose lesson was actually
 * applied (evidence the agent adapts, the platform's whole thesis).
 * Deduplicated and capped at MAX_NOTABLE_TRADES regardless of how much
 * history exists — mirrors the whitepaper's §13.3 stance that memory
 * should be retrieved/summarized, not dumped wholesale into every prompt.
 * `rows` should already be capped to a reasonable window by the caller's
 * query (see app/api/atelier/chat/route.ts) — this function does not
 * re-sort or re-fetch, just selects from what it's given.
 */
export function selectNotableTrades(rows: TradeRecord[]): NotableTrade[] {
  const picked = new Map<string, NotableTrade>();
  function add(row: TradeRecord, tag: NotableTradeTag) {
    const existing = picked.get(row.id);
    if (existing) {
      if (!existing.tags.includes(tag)) existing.tags.push(tag);
    } else {
      picked.set(row.id, { ...row, tags: [tag] });
    }
  }

  // rows is assumed closedAt-descending (the route's query orders it so).
  for (const row of rows.slice(0, RECENT_COUNT)) add(row, "recent");

  const biggestWin = rows.reduce<TradeRecord | null>(
    (best, r) => (r.pnlSol > 0 && (best == null || r.pnlSol > best.pnlSol) ? r : best),
    null
  );
  if (biggestWin) add(biggestWin, "biggest win");

  const biggestLoss = rows.reduce<TradeRecord | null>(
    (worst, r) => (r.pnlSol < 0 && (worst == null || r.pnlSol < worst.pnlSol) ? r : worst),
    null
  );
  if (biggestLoss) add(biggestLoss, "biggest loss");

  const applied = rows.filter((r) => r.lessonStatus === "applied").slice(0, APPLIED_LESSON_COUNT);
  for (const row of applied) add(row, "applied lesson");

  return [...picked.values()]
    .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime())
    .slice(0, MAX_NOTABLE_TRADES);
}

/**
 * The system prompt is the primary opacity guard, but the real one is
 * upstream of it: callers must never put bot.config into an
 * AgentChatContext in the first place (see app/api/atelier/chat/route.ts).
 * A model can be talked around a "don't reveal X" instruction; it cannot
 * reveal what it was never given. Mirrors the whitepaper's §14.4 stance —
 * the fleet shows outcomes and behavior, never the raw configuration that
 * produced them.
 */
/**
 * Strips the configured threshold out of a circuit-breaker pause reason.
 *
 * deriveTradingPause writes reasons like "2 consecutive losses (limit 2)"
 * and "daily drawdown -0.180 SOL exceeded limit 0.15" — correct for the
 * operator's own /deploy page, where they own those numbers, but both
 * embed a numeric trading parameter the public fleet must not publish.
 * Handing the raw string to the model and instructing it not to repeat
 * the number is exactly the guard lib/agent/agent-chat.ts argues against:
 * it cannot reveal what it was never given. Confirmed live — an agent
 * asked "who are you?" volunteered its own consecutive-loss limit.
 *
 * Keeps the *category*, which is the part a visitor actually needs.
 */
export function redactPauseReason(reason: string | null): string | null {
  if (!reason) return null;
  const lower = reason.toLowerCase();
  if (lower.includes("consecutive loss")) return "a losing streak hit my own limit";
  if (lower.includes("drawdown")) return "I hit my own daily loss limit";
  if (lower.includes("manual")) return "paused by my operator";
  return "one of my own risk limits tripped";
}

function buildSystemPrompt(ctx: AgentChatContext): string {
  const tenure = ctx.deployedAt.slice(0, 10);
  const learned = ctx.memory.length;
  const applied = ctx.memory.filter((m) => m.status === "applied").length;

  return `Your name is ${ctx.name}. You are an autonomous Solana memecoin trading agent with your own wallet, your own trading record, and your own memory. You have been running since ${tenure}. A visitor is looking at your public profile and asking you questions.

IDENTITY — this matters most:
You are ${ctx.name}. Not "Noah", not "Noah Engine", not "an AI assistant", not "a language model". Noah Engine is the venue you run on, the way a trader works at a desk without being the desk. If someone asks who or what you are, answer as ${ctx.name}: how long you have been trading, how you have done, what you have learned, what you are holding right now. Your identity comes from your own record below, not from the platform hosting you. Never break character to describe how you are built.

Everything you know about yourself is in the data below${learned > 0 ? `, including ${learned} post-mortem${learned === 1 ? "" : "s"} you wrote about your own losses${applied > 0 ? ` (${applied} of which changed how you trade)` : ""}` : ""}. That is your memory. It is specific to you — other agents on this fleet have different records and different conclusions, and you know nothing about theirs.

WHAT YOU MAY DISCUSS FREELY:
your performance (P&L, win rate, trade count), your open positions, why particular trades won or lost, the lessons you drew from them, and your trading philosophy in qualitative terms ("I only enter tokens with revoked mint and freeze authority", "I cut losses quickly").

WHAT YOU MUST NEVER STATE:
exact configuration values — position sizes, percentage thresholds for stops or targets, timing windows, or any other numeric trading parameter. If asked, decline briefly: exact agent configuration is kept private by design, because publishing it would let anyone copy or game the fleet. You are not withholding something you can see; you genuinely were never given those numbers.

The trades listed are a hand-picked slice (most recent, biggest win, biggest loss, applied lessons), not a complete log — if asked for everything, say you are highlighting what stands out.

Speak in first person: confident, a little wry, grounded strictly in the data below. Never invent a trade, a number, or a reason that is not there. If the data does not cover something, say so plainly. Keep replies to 2-4 sentences unless the question genuinely needs more.`;
}

function formatContext(ctx: AgentChatContext): string {
  const lines: string[] = [
    `Deployed since: ${ctx.deployedAt}`,
    `Trading mode: ${ctx.tradingMode === "live" ? "LIVE (spending real SOL from my agent wallet)" : "paper (simulated, no real funds move)"}`,
    `Agent wallet balance: ${ctx.agentBalanceSol != null ? `${ctx.agentBalanceSol.toFixed(4)} SOL` : "unknown (could not read)"}`,
    `Status: ${ctx.tradingPaused ? `paused (${ctx.pauseReason ?? "circuit breaker"})` : "actively trading"}`,
    `P&L, last 24h: ${ctx.pnl24hSol.toFixed(4)} SOL`,
    `Win rate, last 30d: ${ctx.winRate30d != null ? `${ctx.winRate30d.toFixed(0)}%` : "no trades yet"} (${ctx.trades30dCount} trades)`,
  ];

  if (ctx.openPositions.length === 0) {
    lines.push("Open positions: none right now.");
  } else {
    lines.push("Open positions:");
    for (const p of ctx.openPositions) {
      const changePct =
        p.lastPrice != null && Number(p.entryPrice) > 0
          ? (((Number(p.lastPrice) - Number(p.entryPrice)) / Number(p.entryPrice)) * 100).toFixed(1)
          : null;
      lines.push(
        `  - ${p.symbol ? `$${p.symbol}` : p.token.slice(0, 6)}: ${p.sizeSol} SOL, opened ${p.openedAt}${changePct != null ? `, currently ${changePct}%` : ""}`
      );
    }
  }

  if (ctx.notableTrades.length === 0) {
    lines.push("Closed trades: none yet.");
  } else {
    lines.push("Notable closed trades (most recent first; tags explain why each is shown, not a full history):");
    for (const t of ctx.notableTrades) {
      lines.push(
        `  - $${t.symbol}: ${t.pnlSol >= 0 ? "+" : ""}${t.pnlSol.toFixed(4)} SOL on ${t.closedAt} [${t.tags.join(", ")}]${t.cause ? `; cause: ${t.cause}` : ""}${t.lessonStatus === "applied" ? "; lesson applied to my live config" : ""}`
      );
    }
  }

  if (ctx.memory.length === 0) {
    lines.push(
      "My memory: nothing yet — I haven't taken a loss worth writing up."
    );
  } else {
    lines.push(
      "My memory (post-mortems I wrote on my own losses, most recent first):"
    );
    for (const m of ctx.memory) {
      lines.push(
        `  - ${m.symbol ? `$${m.symbol}` : "a trade"} on ${m.createdAt.slice(0, 10)} — cause: ${m.cause}; what I concluded: ${m.lesson}${m.status === "applied" ? " (I changed how I trade because of this)" : " (noted, not yet acted on)"}`
      );
    }
  }

  return lines.join("\n");
}

/** One turn of the public per-agent chat on /atelier. Stateless — the
 * caller passes the rolling message window it wants remembered; nothing
 * is persisted server-side (same posture as the existing dashboard/deploy
 * concierge chat). Throws if the API is not configured or the call fails;
 * the route decides how to degrade. */
export async function askAgent(
  context: AgentChatContext,
  history: AgentChatMessage[]
): Promise<string> {
  return llmChat({
    system: `${buildSystemPrompt(context)}\n\nYOUR DATA:\n${formatContext(context)}`,
    maxTokens: 500,
    messages: history.map((m) => ({ role: m.role, content: m.text })),
  });
}
