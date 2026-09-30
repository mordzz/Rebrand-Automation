import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { assertNotOfficial } from "@/lib/db/official-bot";
import { userBots } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Accepts either a legacy Solana wallet (base58) or a Robinhood/EVM
 * wallet (0x + 40 hex chars) — see app/api/my-bot/route.ts. */
function isPlausibleWalletAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr) || /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/** Manually clears a deployed bot's circuit breaker (see the breakerResetAt
 * comment on lib/db/schema.ts#userBots) — the escape hatch for a bot whose
 * opening trades tripped maxConsecutiveLosses and, being paused, can never
 * earn the win that would otherwise clear it on its own. Same client-
 * asserted wallet trust model as the rest of app/api/my-bot (demo-stage). */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleWalletAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const [bot] = await db.select().from(userBots).where(eq(userBots.walletAddress, wallet)).limit(1);
  if (!bot) {
    return NextResponse.json({ error: "No automaton deployed" }, { status: 404 });
  }
  const blocked = assertNotOfficial(bot);
  if (blocked) return blocked;

  const breakerResetAt = new Date();
  await db
    .update(userBots)
    .set({ breakerResetAt, updatedAt: breakerResetAt })
    .where(eq(userBots.id, bot.id));

  return NextResponse.json({ ok: true, breakerResetAt });
}
