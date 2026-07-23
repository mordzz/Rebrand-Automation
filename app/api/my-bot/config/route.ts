import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { userBots } from "@/lib/db/schema";
import { getSniperConfig, type SniperConfig } from "@/lib/sniper/config";

export const dynamic = "force-dynamic";

function isPlausibleSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

const BOOLEAN_KEYS: (keyof SniperConfig)[] = [
  "requireMintAuthorityRenounced",
  "requireFreezeAuthorityRenounced",
  "requireSocialLink",
  "trailingStopEnabled",
];

const NUMBER_KEYS: (keyof SniperConfig)[] = [
  "maxCreatorBuyPct",
  "minTokenAgeSec",
  "maxSolPerSnipe",
  "maxConcurrentPositions",
  "maxTotalDeployedSol",
  "takeProfitPct",
  "stopLossPct",
  "trailingStopActivationPct",
  "trailingStopPct",
  "crashDropPct",
  "exitCheckIntervalMs",
  "maxConsecutiveLosses",
  "maxDailyDrawdownSol",
  "cooldownAfterLossSec",
  "metadataFetchTimeoutMs",
];

const NULLABLE_NUMBER_KEYS: (keyof SniperConfig)[] = [
  "maxTokenAgeSec",
  "breakevenAfterPct",
  "maxHoldTimeSec",
];

/** Keeps only known SniperConfig fields with the right primitive types —
 * a user's overlay can never introduce fields the daemon doesn't know. */
function sanitize(raw: Record<string, unknown>): Partial<SniperConfig> {
  const out: Record<string, unknown> = {};
  for (const key of BOOLEAN_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  for (const key of NUMBER_KEYS) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key])) out[key] = raw[key];
  }
  for (const key of NULLABLE_NUMBER_KEYS) {
    if (raw[key] === null || (typeof raw[key] === "number" && Number.isFinite(raw[key])))
      out[key] = raw[key];
  }
  if (raw.exitMode === "fixed" || raw.exitMode === "tiered") out.exitMode = raw.exitMode;
  if (Array.isArray(raw.blockedKeywords)) {
    out.blockedKeywords = raw.blockedKeywords
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 50);
  }
  if (Array.isArray(raw.takeProfitTiers)) {
    out.takeProfitTiers = raw.takeProfitTiers
      .filter(
        (t): t is { atPct: number; sellPortionPct: number } =>
          typeof t === "object" &&
          t !== null &&
          typeof (t as Record<string, unknown>).atPct === "number" &&
          typeof (t as Record<string, unknown>).sellPortionPct === "number"
      )
      .slice(0, 10);
  }
  return out as Partial<SniperConfig>;
}

async function loadBot(wallet: string) {
  const db = getDb();
  if (!db) return null;
  const [bot] = await db
    .select()
    .from(userBots)
    .where(eq(userBots.walletAddress, wallet))
    .limit(1);
  return bot ?? null;
}

/** The user's effective config: house config as the base, their saved
 * overlay on top — new users start from the house tune. */
export async function GET(request: Request) {
  if (!getDb()) return NextResponse.json({ configured: false, config: null });

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleSolanaAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const bot = await loadBot(wallet);
  if (!bot) return NextResponse.json({ configured: false, config: null });

  const base = await getSniperConfig();
  const overlay = sanitize((bot.config ?? {}) as Record<string, unknown>);
  return NextResponse.json({ configured: true, config: { ...base, ...overlay } });
}

/** Saves the user's config overlay (full draft from the editor panel). */
export async function PATCH(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleSolanaAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const bot = await loadBot(wallet);
  if (!bot) {
    return NextResponse.json({ error: "No automaton deployed" }, { status: 404 });
  }

  let raw: Record<string, unknown>;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const overlay = sanitize(raw);
  await db
    .update(userBots)
    .set({ config: overlay, updatedAt: new Date() })
    .where(eq(userBots.id, bot.id));

  const base = await getSniperConfig();
  return NextResponse.json({ configured: true, config: { ...base, ...overlay } });
}
