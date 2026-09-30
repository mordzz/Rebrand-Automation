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

/** Starts or stops a deployed bot — the master switch scripts/paper-daemon.ts
 * reads to decide whether to open new positions for it (see the comment on
 * lib/db/schema.ts#userBots.active). Same client-asserted wallet trust
 * model as the rest of app/api/my-bot (demo-stage). Takes an explicit
 * desired end-state rather than "toggle" to stay correct if the caller's
 * UI state is stale (e.g. two tabs open). */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleWalletAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  let body: { active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "active (boolean) is required" }, { status: 400 });
  }

  const [bot] = await db.select().from(userBots).where(eq(userBots.walletAddress, wallet)).limit(1);
  if (!bot) {
    return NextResponse.json({ error: "No automaton deployed" }, { status: 404 });
  }
  const blocked = assertNotOfficial(bot);
  if (blocked) return blocked;

  const [updated] = await db
    .update(userBots)
    .set({ active: body.active, updatedAt: new Date() })
    .where(eq(userBots.id, bot.id))
    .returning();

  return NextResponse.json({ active: updated.active });
}
