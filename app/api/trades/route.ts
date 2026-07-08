import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { analyzeLoss, type ClosedTradeInput } from "@/lib/agent/analyze-loss";
import { getDb } from "@/lib/db";
import { lessons, trades } from "@/lib/db/schema";

export async function GET() {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ configured: false, data: [] });
  }
  const rows = await db
    .select()
    .from(trades)
    .orderBy(desc(trades.closedAt))
    .limit(50);
  return NextResponse.json({ configured: true, data: rows });
}

/**
 * Record a closed trade. Losing trades are sent to Claude for a post-mortem;
 * the resulting cause + lesson is stored as agent memory.
 */
export async function POST(request: Request) {
  let body: ClosedTradeInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.token || !body.strategy || body.pnlSol === undefined) {
    return NextResponse.json(
      { error: "token, strategy, and pnlSol are required" },
      { status: 400 }
    );
  }

  const pnl = Number(body.pnlSol);
  const isLoss = pnl < 0;

  // 1. The learning step — losing trades get a post-mortem from Claude
  let analysis = null;
  let analysisError: string | null = null;
  if (isLoss) {
    try {
      analysis = await analyzeLoss(body);
    } catch (error) {
      analysisError =
        error instanceof Error ? error.message : "Analysis failed";
    }
  }

  // 2. Persist trade + lesson when the database is configured
  const db = getDb();
  if (!db) {
    return NextResponse.json({
      stored: false,
      reason: "DATABASE_URL not configured",
      analysis,
      analysisError,
    });
  }

  const [trade] = await db
    .insert(trades)
    .values({
      token: body.token,
      strategy: body.strategy,
      entryPrice: body.entryPrice != null ? String(body.entryPrice) : null,
      exitPrice: body.exitPrice != null ? String(body.exitPrice) : null,
      sizeSol: body.sizeSol != null ? String(body.sizeSol) : null,
      pnlSol: String(body.pnlSol),
      openedAt: body.openedAt ? new Date(body.openedAt) : null,
      closedAt: body.closedAt ? new Date(body.closedAt) : new Date(),
      context: body.context ?? null,
    })
    .returning();

  let lesson = null;
  if (analysis) {
    [lesson] = await db
      .insert(lessons)
      .values({
        tradeId: trade.id,
        cause: analysis.cause,
        lesson: analysis.lesson,
      })
      .returning();
  }

  return NextResponse.json({ stored: true, trade, lesson, analysisError });
}
