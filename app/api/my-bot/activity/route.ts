import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logs, trades } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const LOG_LIMIT = 100;
const TRADE_LIMIT = 100;
const FEED_LIMIT = 150;

/** Accepts either a legacy Solana wallet (base58) or a Robinhood/EVM
 * wallet (0x + 40 hex chars) — see app/api/my-bot/route.ts. */
function isPlausibleWalletAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr) || /^0x[0-9a-fA-F]{40}$/.test(addr);
}

type FeedRow = {
  id: string;
  level: string;
  source: string;
  message: string;
  /** Only ever a real on-chain signature. Paper fills store the literal
   * "paper", which is not a transaction and is normalised away here —
   * rendering it as a txid would invite an operator to go looking for
   * something that was never broadcast. */
  txSignature: string | null;
  /** The token itself, which IS a real account even for a paper fill. */
  tokenMint: string | null;
  createdAt: string;
};

function realSignature(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v === "paper" || v === "dry-run") return null;
  return v;
}

/**
 * One chronological feed of everything a deployed bot has done.
 *
 * Merges two sources on purpose:
 *   - `logs`   — events written as they happen (fills, exits, guard trips)
 *   - `trades` — the closed-trade ledger, which reaches back further than
 *                the log does. Per-bot logging only started when the
 *                wallet column was added, so without this half the console
 *                would look empty for every trade that came before it.
 *
 * Trades are rendered from stored facts rather than re-derived prose, and
 * de-duplicated against the log so a trade that produced a log line does
 * not appear twice.
 */
export async function GET(request: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ configured: false, data: [] });

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleWalletAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const [logRows, tradeRows] = await Promise.all([
    db
      .select()
      .from(logs)
      .where(eq(logs.walletAddress, wallet))
      .orderBy(desc(logs.createdAt))
      .limit(LOG_LIMIT),
    db
      .select()
      .from(trades)
      .where(eq(trades.walletAddress, wallet))
      .orderBy(desc(trades.closedAt))
      .limit(TRADE_LIMIT),
  ]);

  const feed: FeedRow[] = logRows.map((row) => ({
    id: `log:${row.id}`,
    level: row.level,
    source: row.source,
    message: row.message,
    txSignature: realSignature(row.txSignature),
    tokenMint: row.tokenMint,
    createdAt: row.createdAt.toISOString(),
  }));

  /* A closed trade that already produced a log line is the same event
     seen twice. The two tables share no key, and matching on mint fails
     for log rows written before that column existed — so match on the
     message, which both sides build to the identical format, within a
     window wide enough to absorb the gap between writing the log and
     committing the trade. */
  const DEDUPE_WINDOW_MS = 90_000;
  const loggedByMessage = new Map<string, { at: number; index: number }[]>();
  logRows.forEach((row, index) => {
    const list = loggedByMessage.get(row.message) ?? [];
    list.push({ at: row.createdAt.getTime(), index });
    loggedByMessage.set(row.message, list);
  });

  for (const trade of tradeRows) {
    const context = (trade.context ?? {}) as Record<string, unknown>;
    const mint = typeof context.mint === "string" ? context.mint : null;
    const closedAt = trade.closedAt;
    const pnl = Number(trade.pnlSol);
    const reason =
      typeof context.exitReason === "string" ? context.exitReason : "closed";
    const message = `${reason} on $${trade.token}: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL`;

    const match = loggedByMessage
      .get(message)
      ?.find((c) => Math.abs(c.at - closedAt.getTime()) <= DEDUPE_WINDOW_MS);

    if (match) {
      // Same event. Keep the log line, but take the mint from the trade —
      // rows logged before the mint column existed have none, and that is
      // exactly the link the console wants to render.
      if (!feed[match.index].tokenMint && mint) {
        feed[match.index].tokenMint = mint;
      }
      if (!feed[match.index].txSignature) {
        feed[match.index].txSignature = realSignature(context.exitTxSignature);
      }
      continue;
    }

    feed.push({
      id: `trade:${trade.id}`,
      level: pnl >= 0 ? "sell" : "guard",
      source: typeof context.engine === "string" ? context.engine : "sniper",
      message,
      txSignature: realSignature(context.exitTxSignature),
      tokenMint: mint,
      createdAt: closedAt.toISOString(),
    });
  }

  feed.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Chronological for the terminal's top-to-bottom scroll, newest last.
  return NextResponse.json({
    configured: true,
    data: feed.slice(-FEED_LIMIT),
  });
}
