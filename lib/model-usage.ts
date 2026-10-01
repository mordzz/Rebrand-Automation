import { getDb } from "@/lib/db";
import { modelRequests } from "@/drizzle/schema";
import { primaryEnabledProvider } from "@/lib/eliza/model-providers";

/**
 * Records one real model call (from ElizaOS's MODEL_USED event — see
 * lib/eliza/runtime.ts) or one real chat turn (modelType: "chat_turn",
 * written directly by app/api/chat/route.ts with an accurate measured
 * latency). Best-effort: a logging failure must never break the actual
 * chat/model call it's describing.
 */
export async function recordModelUsage(entry: {
  modelType: string;
  totalTokens?: number | null;
  latencyMs?: number | null;
}): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(modelRequests).values({
      provider: primaryEnabledProvider() ?? "unknown",
      modelType: entry.modelType,
      totalTokens: entry.totalTokens != null ? String(entry.totalTokens) : null,
      latencyMs: entry.latencyMs != null ? String(entry.latencyMs) : null,
    });
  } catch {
    // best-effort — never let usage logging break the real request
  }
}
