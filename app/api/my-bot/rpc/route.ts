import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { userBots } from "@/lib/db/schema";
import { maskRpcUrl, validateRpcUrl } from "@/lib/solana/rpc-validate";

export const dynamic = "force-dynamic";

function isPlausibleSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
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

/**
 * A deployed bot's private RPC endpoint.
 *
 * The raw URL is never returned by any method here — provider URLs carry
 * an API key, and this endpoint trusts a client-asserted wallet like the
 * rest of app/api/my-bot, so returning it would hand the key to anyone
 * who knows a wallet address. Reads get a masked host only.
 */
export async function GET(request: Request) {
  if (!getDb()) return NextResponse.json({ configured: false, rpc: null });

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleSolanaAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const bot = await loadBot(wallet);
  if (!bot) return NextResponse.json({ configured: false, rpc: null });

  return NextResponse.json({
    configured: true,
    rpc: bot.rpcUrl ? { masked: maskRpcUrl(bot.rpcUrl) } : null,
  });
}

/** Validates the endpoint (public https, answers getVersion) and stores it,
 * returning the measured round-trip so the operator sees a real number. */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleSolanaAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bot = await loadBot(wallet);
  if (!bot) {
    return NextResponse.json({ error: "No automaton deployed" }, { status: 404 });
  }

  const result = await validateRpcUrl(body.url ?? "");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await db
    .update(userBots)
    .set({ rpcUrl: result.url, updatedAt: new Date() })
    .where(eq(userBots.id, bot.id));

  return NextResponse.json({
    ok: true,
    rpc: { masked: maskRpcUrl(result.url) },
    latencyMs: result.latencyMs,
    version: result.version,
  });
}

/** Clears it — the bot falls back to the shared endpoint. */
export async function DELETE(request: Request) {
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

  await db
    .update(userBots)
    .set({ rpcUrl: null, updatedAt: new Date() })
    .where(eq(userBots.id, bot.id));

  return NextResponse.json({ ok: true, rpc: null });
}
