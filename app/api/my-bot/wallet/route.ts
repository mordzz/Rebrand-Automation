import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { userBots } from "@/lib/db/schema";
import {
  isAgentWalletConfigured,
  withdrawFromAgentWallet,
} from "@/lib/solana/agent-wallet";
import { getEffectiveConfig } from "@/lib/sniper/effective-config";
import { getAddressBalance } from "@/lib/solana/wallet";

export const dynamic = "force-dynamic";

/** Leave enough behind to pay the transaction fee, so "withdraw
 * everything" cannot pass the balance check and then fail on-chain. */
const FEE_HEADROOM_SOL = 0.00001;

/** Mirrors LIVE_FEE_HEADROOM_SOL in scripts/paper-daemon.ts: held back from
 * every live buy for the swap fee and the token account rent, so a wallet
 * can always afford to sell back out of what it bought. */
const LIVE_FEE_HEADROOM_SOL = 0.01;

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
 * The agent's own trading wallet: address and live balance.
 *
 * `?wallet=` is the operator's Phantom address (who owns the bot); the
 * address returned is the agent's separate trading wallet. The encrypted
 * secret is never part of any response here.
 */
export async function GET(request: Request) {
  if (!getDb()) return NextResponse.json({ configured: false, wallet: null });

  const owner = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleSolanaAddress(owner)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const bot = await loadBot(owner);
  if (!bot) return NextResponse.json({ configured: false, wallet: null });

  if (!bot.agentPublicKey) {
    return NextResponse.json({
      configured: true,
      wallet: null,
      // Tells the UI why there's no wallet rather than looking broken.
      reason: isAgentWalletConfigured()
        ? "not_generated"
        : "encryption_key_missing",
    });
  }

  const [balance, config] = await Promise.all([
    getAddressBalance(bot.agentPublicKey),
    getEffectiveConfig(bot),
  ]);

  /* What one trade actually costs this bot, computed from its own config
     rather than a fixed number — an operator who raised their position
     size needs to be told the larger figure, not a stale default. */
  // Rounded: floating-point addition here yields 0.060000000000000005,
  // and shipping that in an API response is just noise.
  const requiredSol =
    Math.round((config.maxSolPerSnipe + LIVE_FEE_HEADROOM_SOL) * 1e6) / 1e6;
  const balanceSol = balance.balanceSol ?? null;

  return NextResponse.json({
    configured: true,
    wallet: {
      address: bot.agentPublicKey,
      balanceSol,
      balanceUsd: balance.balanceUsd ?? null,
      error: balance.error ?? null,
      requiredSol,
      // The position size on its own, so the go-live confirmation can
      // quote what a trade costs without re-deriving it from requiredSol.
      sizeSol: config.maxSolPerSnipe,
      // null balance means "couldn't read", which must not read as
      // "underfunded" — that would nag on every RPC hiccup.
      sufficient: balanceSol == null ? null : balanceSol >= requiredSol,
    },
    tradingMode: bot.tradingMode,
    active: bot.active,
  });
}

/** Withdraws SOL from the agent wallet to any address the operator names. */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const owner = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleSolanaAddress(owner)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  let body: { destination?: string; amountSol?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const destination = (body.destination ?? "").trim();
  if (!isPlausibleSolanaAddress(destination)) {
    return NextResponse.json(
      { error: "Enter a valid Solana destination address." },
      { status: 400 }
    );
  }

  const amountSol = Number(body.amountSol);
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    return NextResponse.json(
      { error: "Enter an amount greater than zero." },
      { status: 400 }
    );
  }

  const bot = await loadBot(owner);
  if (!bot?.agentSecretEnc || !bot.agentPublicKey) {
    return NextResponse.json({ error: "This agent has no wallet." }, { status: 404 });
  }

  /* Check the balance server-side rather than trusting the amount the
     browser sent. Without this a request could ask for more than the
     wallet holds and fail on-chain after the operator was told it was
     submitted. */
  const balance = await getAddressBalance(bot.agentPublicKey);
  if (balance.balanceSol == null) {
    return NextResponse.json(
      { error: "Could not read the wallet balance — try again shortly." },
      { status: 503 }
    );
  }
  const spendable = balance.balanceSol - FEE_HEADROOM_SOL;
  if (amountSol > spendable) {
    return NextResponse.json(
      {
        error: `Only ${Math.max(0, spendable).toFixed(5)} SOL is available after leaving room for the fee.`,
      },
      { status: 400 }
    );
  }

  try {
    const result = await withdrawFromAgentWallet(
      bot.agentSecretEnc,
      destination,
      amountSol
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Withdrawal failed.",
      },
      { status: 500 }
    );
  }
}
