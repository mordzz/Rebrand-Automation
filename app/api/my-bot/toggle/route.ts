import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { assertNotOfficial } from "@/lib/db/official-bot";
import { userBots } from "@/lib/db/schema";
import { authErrorResponse, authenticateEvmOwner } from "@/lib/auth/privy-server";

export const dynamic = "force-dynamic";

/** Starts or stops a deployed bot — the master switch scripts/paper-daemon.ts
 * reads to decide whether to open new positions for it (see the comment on
 * lib/db/schema.ts#userBots.active). Requires a verified Privy owner of
 * the EVM wallet (lib/auth/privy-server.ts), like every my-bot mutation. Takes an explicit
 * desired end-state rather than "toggle" to stay correct if the caller's
 * UI state is stale (e.g. two tabs open). */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  // PR09: mutations require a verified Privy user that owns this EVM wallet.
  const auth = await authenticateEvmOwner(request, wallet);
  if (!auth.ok) return authErrorResponse(auth);

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
