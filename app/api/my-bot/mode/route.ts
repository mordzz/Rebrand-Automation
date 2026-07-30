import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { userBots } from "@/lib/db/schema";
import { getEffectiveConfig } from "@/lib/sniper/effective-config";
import { getAddressBalance } from "@/lib/solana/wallet";

export const dynamic = "force-dynamic";

/** Mirrors LIVE_FEE_HEADROOM_SOL in scripts/paper-daemon.ts. */
const LIVE_FEE_HEADROOM_SOL = 0.01;

function isPlausibleSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/**
 * Switches a bot between paper and live.
 *
 * Separate from the Start/Stop switch on purpose: Start says the bot may
 * trade, this says whether those trades spend real money. Collapsing the
 * two would make "going live" a side effect of a button an operator
 * presses casually many times a day.
 *
 * Going live requires a funded agent wallet — a live bot with an empty
 * wallet would just log failures on every candidate it liked.
 */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const owner = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleSolanaAddress(owner)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  let body: { mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode;
  if (mode !== "paper" && mode !== "live") {
    return NextResponse.json({ error: "mode must be 'paper' or 'live'" }, { status: 400 });
  }

  const [bot] = await db
    .select()
    .from(userBots)
    .where(eq(userBots.walletAddress, owner))
    .limit(1);
  if (!bot) {
    return NextResponse.json({ error: "No automaton deployed" }, { status: 404 });
  }

  if (mode === "live") {
    if (!bot.agentPublicKey) {
      return NextResponse.json(
        { error: "This agent has no wallet to trade from." },
        { status: 400 }
      );
    }
    const balance = await getAddressBalance(bot.agentPublicKey);
    if (balance.balanceSol == null) {
      return NextResponse.json(
        { error: "Could not read the agent wallet balance — try again shortly." },
        { status: 503 }
      );
    }
    /* Gate on what a trade actually costs, not merely on a non-zero
       balance. A wallet holding dust would clear a `> 0` check, go live,
       and then fail to fill on every candidate it liked — the silent
       failure this check exists to prevent. `needsFunding` lets the UI
       answer with the funding modal instead of a bare error string. */
    const config = await getEffectiveConfig(bot);
    const requiredSol =
      Math.round((config.maxSolPerSnipe + LIVE_FEE_HEADROOM_SOL) * 1e6) / 1e6;
    if (balance.balanceSol < requiredSol) {
      return NextResponse.json(
        {
          error: `Deposit at least ${requiredSol} SOL into the agent wallet before going live.`,
          needsFunding: true,
        },
        { status: 400 }
      );
    }
  }

  await db
    .update(userBots)
    .set({ tradingMode: mode, updatedAt: new Date() })
    .where(eq(userBots.id, bot.id));

  return NextResponse.json({ ok: true, tradingMode: mode });
}
