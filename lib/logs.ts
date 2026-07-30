import { getDb } from "@/lib/db";
import { logs } from "@/lib/db/schema";

export type LogLevel = "info" | "buy" | "sell" | "guard" | "warn" | "error";

/**
 * Writes one row to the real execution log. Deliberately curated, not a
 * firehose — call this for trade-lifecycle events worth showing a human,
 * not every evaluated-and-skipped token (pump.fun launch volume would
 * flood it). Best-effort: a logging failure must never break the caller's
 * real work.
 *
 * `walletAddress` follows the same null-means-house-desk convention as
 * trades/positions: omitted routes the line to the dashboard's terminal,
 * set routes it to that one deployed bot's own console on /deploy. Getting
 * this wrong is not cosmetic — an unscoped write from the per-user paper
 * daemon would publish every operator's activity into the house feed.
 */
export async function writeLog(entry: {
  level: LogLevel;
  message: string;
  source?: string;
  txSignature?: string;
  walletAddress?: string | null;
  tokenMint?: string | null;
}): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(logs).values({
      walletAddress: entry.walletAddress ?? null,
      level: entry.level,
      source: entry.source ?? "sniper",
      message: entry.message,
      txSignature: entry.txSignature ?? null,
      tokenMint: entry.tokenMint ?? null,
    });
  } catch {
    // best-effort — never let log persistence break the real caller
  }
}
