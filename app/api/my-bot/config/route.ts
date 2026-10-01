import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { assertNotOfficial } from "@/lib/db/official-bot";
import { userBots } from "@/drizzle/schema";
import { authErrorResponse, authenticateEvmOwner } from "@/lib/auth/privy-server";
import { getEffectiveConfig, sanitize } from "@/lib/sniper/effective-config";

export const dynamic = "force-dynamic";

/** Accepts either a legacy Solana wallet (base58) or a Robinhood/EVM
 * wallet (0x + 40 hex chars) — see app/api/my-bot/route.ts. */
function isPlausibleWalletAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr) || /^0x[0-9a-fA-F]{40}$/.test(addr);
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
  if (!isPlausibleWalletAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const bot = await loadBot(wallet);
  if (!bot) return NextResponse.json({ configured: false, config: null });

  const config = await getEffectiveConfig(bot);
  return NextResponse.json({ configured: true, config });
}

/** Saves the user's config overlay (full draft from the editor panel). */
export async function PATCH(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  // PR09: mutations require a verified Privy user that owns this EVM wallet.
  const auth = await authenticateEvmOwner(request, wallet);
  if (!auth.ok) return authErrorResponse(auth);

  const bot = await loadBot(wallet);
  if (!bot) {
    return NextResponse.json({ error: "No automaton deployed" }, { status: 404 });
  }
  const blocked = assertNotOfficial(bot);
  if (blocked) return blocked;

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

  const config = await getEffectiveConfig({ config: overlay });
  return NextResponse.json({ configured: true, config });
}
