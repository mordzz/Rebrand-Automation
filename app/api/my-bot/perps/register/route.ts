import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { authErrorResponse, authenticateEvmOwner } from "@/lib/auth/privy-server";
import { getDb } from "@/lib/db";
import { assertNotOfficial } from "@/lib/db/official-bot";
import { userBots } from "@/lib/db/schema";
import { registerBotLighterApiKey } from "@/lib/lighter/bot-credentials";
import { LighterRegistrationError } from "@/lib/lighter/registration";

export const dynamic = "force-dynamic";

/**
 * Registers (idempotently) the bot's Lighter API key on the agent-wallet-
 * owned Lighter account — PR12, testnet only. Owner-authenticated. Never
 * rotates an existing key; never returns key material.
 */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  // PR09: mutations require a verified Privy user that owns this EVM wallet.
  const auth = await authenticateEvmOwner(request, wallet);
  if (!auth.ok) return authErrorResponse(auth);

  const [bot] = await db.select().from(userBots).where(eq(userBots.walletAddress, wallet)).limit(1);
  if (!bot) return NextResponse.json({ error: "No automaton deployed" }, { status: 404 });
  const blocked = assertNotOfficial(bot);
  if (blocked) return blocked;

  try {
    const r = await registerBotLighterApiKey(bot);
    return NextResponse.json({ ok: true, ...r });
  } catch (error) {
    const status =
      error instanceof LighterRegistrationError
        ? { mainnet_refused: 403, no_account: 409, ambiguous_account: 409, slot_occupied: 409, intent_mismatch: 500, not_confirmed: 202, invalid_state: 409 }[error.kind]
        : 503;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Registration failed" }, { status });
  }
}
