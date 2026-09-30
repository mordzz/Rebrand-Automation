import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { formatEther } from "viem";

import { getDb } from "@/lib/db";
import { assertNotOfficial } from "@/lib/db/official-bot";
import { userBots } from "@/lib/db/schema";
import { authErrorResponse, authenticateEvmOwner } from "@/lib/auth/privy-server";
import { ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { getNativeBalance } from "@/lib/chain/rpc";
import { getEffectiveConfig } from "@/lib/sniper/effective-config";
import { resolveRobinhoodNativeLimits } from "@/lib/sniper/risk-limits-robinhood";

export const dynamic = "force-dynamic";

/** Gas headroom on top of one snipe's size, in wei (0.0005 ETH). Robinhood
 * Chain is an L2, so this comfortably covers a buy, the exact-amount
 * approvals, and the sell that the PR10 canary exercises. */
const LIVE_GAS_HEADROOM_WEI = BigInt(500_000_000_000_000);

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
  // PR09: mutations require a verified Privy user that owns this EVM wallet.
  const auth = await authenticateEvmOwner(request, owner);
  if (!auth.ok) return authErrorResponse(auth);

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
  const blocked = assertNotOfficial(bot);
  if (blocked) return blocked;

  if (mode === "live") {
    if (!bot.agentPublicKey) {
      return NextResponse.json(
        { error: "This agent has no wallet to trade from." },
        { status: 400 }
      );
    }
    /* PR09A retired Solana live execution; only a Robinhood agent wallet
       on the active network can be gated (and later traded) here. */
    if (bot.agentChain !== "robinhood" || bot.agentNetwork !== ROBINHOOD_NETWORK) {
      return NextResponse.json(
        { error: "Live mode requires a Robinhood agent wallet on the active network." },
        { status: 410 }
      );
    }
    /* Gate on what a trade actually costs, not merely on a non-zero
       balance. A wallet holding dust would clear a `> 0` check, go live,
       and then fail to fill on every candidate it liked — the silent
       failure this check exists to prevent. `needsFunding` lets the UI
       answer with the funding modal instead of a bare error string. */
    const limits = resolveRobinhoodNativeLimits(await getEffectiveConfig(bot));
    if (!limits.ok) {
      return NextResponse.json({ error: limits.reason }, { status: 400 });
    }
    let balanceWei: bigint;
    try {
      balanceWei = await getNativeBalance(bot.agentPublicKey);
    } catch {
      return NextResponse.json(
        { error: "Could not read the agent wallet balance — try again shortly." },
        { status: 503 }
      );
    }
    // Snipe size is ETH (a number); compare in wei via gwei to avoid float noise.
    const requiredWei =
      BigInt(Math.ceil(limits.limits.maxNativePerSnipe * 1e9)) * BigInt(1e9) + LIVE_GAS_HEADROOM_WEI;
    if (balanceWei < requiredWei) {
      return NextResponse.json(
        {
          error: `Deposit at least ${formatEther(requiredWei)} ETH into the agent wallet before going live.`,
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
