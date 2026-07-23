import { getDb } from "@/lib/db";
import { logs } from "@/lib/db/schema";

export type LogLevel = "info" | "buy" | "sell" | "guard" | "warn" | "error";

/**
 * Writes one row to the real execution log (dashboard's execution
 * terminal). Deliberately curated, not a firehose — call this for
 * trade-lifecycle events worth showing a human, not every evaluated-and-
 * skipped token (pump.fun launch volume would flood it). Best-effort: a
 * logging failure must never break the caller's real work.
 */
export async function writeLog(entry: {
  level: LogLevel;
  message: string;
  source?: string;
  txSignature?: string;
}): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(logs).values({
      level: entry.level,
      source: entry.source ?? "sniper",
      message: entry.message,
      txSignature: entry.txSignature ?? null,
    });
  } catch {
    // best-effort — never let log persistence break the real caller
  }
}
