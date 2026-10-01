import { and, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  askAgent,
  redactPauseReason,
  selectNotableTrades,
  type AgentChatContext,
} from "@/lib/agent/agent-chat";
import { isLlmConfigured, llmLabel } from "@/lib/agent/llm";
import { getDb } from "@/lib/db";
import { lessons, trades, userBots } from "@/lib/db/schema";
import { getOpenPositions } from "@/lib/sniper/positions";
import { getEffectiveConfig } from "@/lib/sniper/effective-config";
import { agentNativeBalance, robinhoodBreakerStatus, summarizePnl, tradeWon } from "@/lib/agent/bot-summary";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
/* How many turns of the caller's conversation are re-sent to the model.
   The conversation itself is never stored: /atelier has no visitor login,
   so a persisted thread would be one shared transcript that every visitor
   reads and writes - one person's questions shown to the next. Keeping it
   in the browser tab makes each visit its own conversation, and closing
   the modal ends it. The agent's *own* memory (its post-mortems and trade
   record) still lives in the database and is what gives it an identity -
   see the memory field on AgentChatContext. */
const MODEL_HISTORY_TURNS = 12;
/** Bounds on the client-supplied window - this route is public and
 *  unauthenticated, so neither length is allowed to be a caller's choice. */
const MAX_TEXT_LEN = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// How far back selectNotableTrades is allowed to look for a "biggest
// win"/"biggest loss" - bounded so the query stays cheap no matter how long
// an agent has been trading; going deeper than this for a live chat answer
// has sharply diminishing value anyway.
const NOTABLE_TRADE_WINDOW = 100;
// How many of this agent's own post-mortems go into its self-description.
// Bounded for the same reason as the trade window: a long-running agent
// accumulates these indefinitely, and the most recent conclusions are the
// ones that describe who it is now.
const MEMORY_LIMIT = 6;
// A chat burst is a few turns over seconds to minutes; nothing about a
// bot's own performance data changes that fast (it moves at paper-trade
// speed, not chat speed), so re-deriving the full context on every single
// turn is pure waste. Short, self-expiring, in-memory - same shape as the
// daemon's own breaker cache in scripts/paper-daemon.ts. This caches only
// performance data, never the conversation itself - the conversation is
// always read from and written to agent_chat_messages below.
const CONTEXT_CACHE_TTL_MS = 10_000;
const contextCache = new Map<string, { context: AgentChatContext; expiresAt: number }>();

function isValidBotId(botId: string): boolean {
  return UUID_RE.test(botId);
}

async function buildContext(
  db: NonNullable<ReturnType<typeof getDb>>,
  bot: typeof userBots.$inferSelect
): Promise<AgentChatContext> {
  const cached = contextCache.get(bot.id);
  if (cached && cached.expiresAt > Date.now()) return cached.context;

  const wallet = bot.walletAddress;
  const since24h = new Date(Date.now() - DAY_MS);
  const since30d = new Date(Date.now() - 30 * DAY_MS);

  const [config, openPositions, trades24h, trades30d, tradeWindow, memoryRows] =
    await Promise.all([
      getEffectiveConfig(bot),
      getOpenPositions(wallet),
      db.select().from(trades).where(and(eq(trades.walletAddress, wallet), gte(trades.closedAt, since24h))),
      db.select().from(trades).where(and(eq(trades.walletAddress, wallet), gte(trades.closedAt, since30d))),
      db
        .select({
          id: trades.id,
          symbol: trades.token,
          pnlNative: trades.pnlNative,
          closedAt: trades.closedAt,
          cause: lessons.cause,
          lessonStatus: lessons.status,
        })
        .from(trades)
        .leftJoin(lessons, eq(lessons.tradeId, trades.id))
        .where(eq(trades.walletAddress, wallet))
        .orderBy(desc(trades.closedAt))
        .limit(NOTABLE_TRADE_WINDOW),
      /* This agent's own post-mortems - joined through its own trades, so
         one agent can never be handed another's conclusions. */
      db
        .select({
          symbol: trades.token,
          cause: lessons.cause,
          lesson: lessons.lesson,
          status: lessons.status,
          createdAt: lessons.createdAt,
        })
        .from(lessons)
        .innerJoin(trades, eq(lessons.tradeId, trades.id))
        .where(eq(trades.walletAddress, wallet))
        .orderBy(desc(lessons.createdAt))
        .limit(MEMORY_LIMIT),
    ]);

  const pnl24h = summarizePnl(trades24h);
  const wins30d = trades30d.filter(tradeWon).length;
  const winRate30d = trades30d.length > 0 ? (wins30d / trades30d.length) * 100 : null;
  const breaker = await robinhoodBreakerStatus(wallet, bot.breakerResetAt, config);

  // The agent's own trading wallet balance (Robinhood RPC, ETH).
  const agentBalanceNative = await agentNativeBalance(bot);

  const context: AgentChatContext = {
    name: bot.name,
    characterType: bot.characterType,
    deployedAt: bot.createdAt.toISOString(),
    tradingMode: bot.tradingMode as "paper" | "live",
    tradingPaused: breaker.tradingPaused,
    pauseReason: redactPauseReason(breaker.pauseReason),
    pnl24hNative: pnl24h.pnlNative,
    nativeSymbol: pnl24h.nativeSymbol,
    winRate30d,
    trades30dCount: trades30d.length,
    agentBalanceNative,
    openPositions: openPositions.map((p) => ({
      symbol: p.symbol,
      tokenAddress: p.tokenAddress,
      sizeNative: p.sizeNative,
      nativeSymbol: p.nativeSymbol ?? "ETH",
      entryPrice: p.entryPrice,
      lastPrice: p.lastPrice,
      openedAt: p.openedAt.toISOString(),
    })),
    notableTrades: selectNotableTrades(
      tradeWindow.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        pnlNative: Number(t.pnlNative),
        closedAt: t.closedAt.toISOString(),
        cause: t.cause,
        lessonStatus: t.lessonStatus as "learning" | "applied" | null,
      }))
    ),
    memory: memoryRows.map((m) => ({
      symbol: m.symbol,
      cause: m.cause,
      lesson: m.lesson,
      status: m.status as "learning" | "applied",
      createdAt: m.createdAt.toISOString(),
    })),
  };

  contextCache.set(bot.id, { context, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS });
  return context;
}

/**
 * POST { botId, messages } - answers one turn as this agent, grounded in
 * its own performance and its own post-mortems (never bot.config; see the
 * opacity note on lib/agent/agent-chat.ts).
 *
 * Stateless: the caller sends the conversation it wants remembered and
 * nothing is written back. Looked up by bot id rather than wallet address,
 * because /api/atelier only ever sends the client a truncated wallet
 * string - the full address never has to round-trip from the browser.
 */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  let body: { botId?: string; messages?: { role?: string; text?: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const botId = body.botId ?? "";
  if (!isValidBotId(botId)) {
    return NextResponse.json({ error: "Invalid botId" }, { status: 400 });
  }

  /* Only the trailing window is kept, and only well-formed turns: an
     unauthenticated caller must not be able to grow the prompt without
     bound, and a stray role would be passed straight to the provider. */
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter(
      (m): m is { role: "user" | "assistant"; text: string } =>
        (m?.role === "user" || m?.role === "assistant") &&
        typeof m.text === "string" &&
        m.text.trim().length > 0
    )
    .slice(-MODEL_HISTORY_TURNS)
    .map((m) => ({ role: m.role, text: m.text.slice(0, MAX_TEXT_LEN) }));

  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "messages must end with a user turn" },
      { status: 400 }
    );
  }

  const [bot] = await db.select().from(userBots).where(eq(userBots.id, botId)).limit(1);
  if (!bot) {
    return NextResponse.json({ error: "No such agent" }, { status: 404 });
  }

  if (!isLlmConfigured()) {
    return NextResponse.json({
      configured: false,
      reply:
        "This agent isn't wired up to chat yet: set OPENROUTER_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY).",
    });
  }

  try {
    const context = await buildContext(db, bot);
    const reply = await askAgent(context, history);
    return NextResponse.json({ configured: true, reply });
  } catch (error) {
    return NextResponse.json({
      configured: true,
      reply: "Something interrupted me mid-thought, try again in a moment.",
      provider: llmLabel(),
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
