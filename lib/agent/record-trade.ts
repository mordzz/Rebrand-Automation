import {
  analyzeLoss,
  type ClosedTradeInput,
  type LossAnalysis,
} from "@/lib/agent/analyze-loss";
import { getDb } from "@/lib/db";
import { lessons, trades, type Lesson, type Trade } from "@/lib/db/schema";
import { llmModelId } from "@/lib/agent/llm";

export type RecordTradeResult =
  | {
      stored: false;
      reason: string;
      analysis: LossAnalysis | null;
      analysisError: string | null;
    }
  | {
      stored: true;
      trade: Trade;
      lesson: Lesson | null;
      analysisError: string | null;
    };

/**
 * Records a closed trade (manual entry via /api/trades, or a Sniper exit):
 * losing trades get a Claude post-mortem first, then the trade + any
 * resulting lesson are persisted. Extracted from app/api/trades/route.ts so
 * the sniper daemon (a plain Node process, not a Next.js request handler)
 * can call this directly instead of hitting its own HTTP API.
 *
 * `walletAddress` scopes the trade to one deployed bot's own ledger —
 * null (the default) means the shared house desk, matching every other
 * caller (the sniper daemon) that never passes one.
 */
export async function recordClosedTrade(
  input: ClosedTradeInput,
  walletAddress: string | null = null,
): Promise<RecordTradeResult> {
  // PR07 hardening: pnlNative is authoritative when present (a Robinhood
  // trade), not the pnlSol compatibility shadow — same number/sign for a
  // Robinhood row today, but this stops depending on that coincidence.
  // Solana trades never set pnlNative, so this is unchanged for them.
  const pnl = Number(input.pnlNative ?? input.pnlSol);
  const isLoss = pnl < 0;

  let analysis: LossAnalysis | null = null;
  let analysisError: string | null = null;
  if (isLoss) {
    try {
      analysis = await analyzeLoss(input);
    } catch (error) {
      analysisError =
        error instanceof Error ? error.message : "Analysis failed";
    }
  }

  const db = getDb();
  if (!db) {
    return {
      stored: false,
      reason: "DATABASE_URL not configured",
      analysis,
      analysisError,
    };
  }

  const [trade] = await db
    .insert(trades)
    .values({
      walletAddress,
      token: input.token,
      strategy: input.strategy,
      entryPrice: input.entryPrice != null ? String(input.entryPrice) : null,
      exitPrice: input.exitPrice != null ? String(input.exitPrice) : null,
      sizeSol: input.sizeSol != null ? String(input.sizeSol) : null,
      pnlSol: String(input.pnlSol),
      sizeNative: input.sizeNative != null ? String(input.sizeNative) : null,
      pnlNative: input.pnlNative != null ? String(input.pnlNative) : null,
      nativeSymbol: input.nativeSymbol ?? null,
      chain: input.chain ?? null,
      network: input.network ?? null,
      openedAt: input.openedAt ? new Date(input.openedAt) : null,
      closedAt: input.closedAt ? new Date(input.closedAt) : new Date(),
      context: input.context ?? null,
    })
    .returning();

  let lesson: Lesson | null = null;
  if (analysis) {
    [lesson] = await db
      .insert(lessons)
      .values({
        tradeId: trade.id,
        cause: analysis.cause,
        lesson: analysis.lesson,
        suggestedConfig: analysis.suggestedConfig ?? null,
        // Recorded, not defaulted: the base model is environment-driven
        // now, so the column default would misattribute every lesson.
        model: llmModelId(),
      })
      .returning();
  }

  return { stored: true, trade, lesson, analysisError };
}
