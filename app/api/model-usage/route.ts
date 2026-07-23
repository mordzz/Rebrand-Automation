import { gte } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { modelRequests } from "@/lib/db/schema";
import { getProviderStatuses, type ProviderId } from "@/lib/eliza/model-providers";

export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const PROVIDER_IDS: ProviderId[] = ["openrouter", "anthropic", "openai"];

type HourBucket = { hour: string } & Record<ProviderId, number>;

function buildHourlyBuckets(
  rows: { provider: string; createdAt: Date }[]
): HourBucket[] {
  const now = new Date();
  const buckets = new Map<number, HourBucket>();

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * HOUR_MS);
    d.setMinutes(0, 0, 0);
    buckets.set(d.getTime(), {
      hour: d.toLocaleTimeString("en-US", { hour: "2-digit", hour12: false }) + ":00",
      openrouter: 0,
      anthropic: 0,
      openai: 0,
    });
  }

  for (const row of rows) {
    const d = new Date(row.createdAt);
    d.setMinutes(0, 0, 0);
    const bucket = buckets.get(d.getTime());
    if (bucket && PROVIDER_IDS.includes(row.provider as ProviderId)) {
      bucket[row.provider as ProviderId] += 1;
    }
  }

  return Array.from(buckets.values());
}

export async function GET() {
  const providers = getProviderStatuses().map(({ id, name, configured, enabled }) => ({
    id,
    name,
    configured,
    enabled,
  }));

  const db = getDb();
  if (!db) {
    return NextResponse.json({
      configured: false,
      providers,
      hourly: [],
      totalRequests24h: 0,
      avgLatencyMs: null,
    });
  }

  const since24h = new Date(Date.now() - 24 * HOUR_MS);
  const rows = await db
    .select()
    .from(modelRequests)
    .where(gte(modelRequests.createdAt, since24h));

  // Real per-model calls (from ElizaOS's MODEL_USED event) drive the chart;
  // "chat_turn" rows are written separately per chat exchange purely to
  // carry an accurate measured latency (the event itself has no timing).
  const modelRows = rows.filter((r) => r.modelType !== "chat_turn");
  const latencyRows = rows.filter(
    (r) => r.modelType === "chat_turn" && r.latencyMs != null
  );

  const avgLatencyMs =
    latencyRows.length > 0
      ? latencyRows.reduce((sum, r) => sum + Number(r.latencyMs), 0) / latencyRows.length
      : null;

  return NextResponse.json({
    configured: true,
    providers,
    hourly: buildHourlyBuckets(modelRows),
    totalRequests24h: modelRows.length,
    avgLatencyMs,
  });
}
