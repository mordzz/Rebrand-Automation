import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { assertNotOfficial } from "@/lib/db/official-bot";
import { userBots } from "@/lib/db/schema";
import { authErrorResponse, authenticateEvmOwner } from "@/lib/auth/privy-server";

export const dynamic = "force-dynamic";

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
  // PR09: mutations require a verified Privy user that owns this EVM wallet.
  const auth = await authenticateEvmOwner(request, wallet);
  if (!auth.ok) return authErrorResponse(auth);

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
