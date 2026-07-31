import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { userBots } from "@/lib/db/schema";
import {
  generateAgentWallet,
  isAgentWalletConfigured,
} from "@/lib/solana/agent-wallet";

export const dynamic = "force-dynamic";

function isPlausibleSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/**
 * Generates an agent wallet for an existing automaton that was deployed
 * before AGENT_WALLET_ENCRYPTION_KEY was configured.
 *
 * 1 agent wallet per automaton (account). If a wallet already exists for this
 * automaton, this route is idempotent and returns the existing public key.
 */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const searchParams = new URL(request.url).searchParams;
  let wallet = searchParams.get("wallet") ?? "";

  // Also check JSON body if searchParams was empty
  if (!wallet) {
    try {
      const body = (await request.json()) as { wallet?: string };
      wallet = body.wallet ?? "";
    } catch {
      // JSON body optional
    }
  }

  if (!isPlausibleSolanaAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  if (!isAgentWalletConfigured()) {
    return NextResponse.json(
      {
        error:
          "AGENT_WALLET_ENCRYPTION_KEY is not configured on the server. Please set it in your environment variables.",
      },
      { status: 400 }
    );
  }

  const [bot] = await db
    .select()
    .from(userBots)
    .where(eq(userBots.walletAddress, wallet))
    .limit(1);

  if (!bot) {
    return NextResponse.json(
      { error: "No automaton found for this wallet. Deploy an agent first." },
      { status: 404 }
    );
  }

  // If the agent already has a wallet, do not generate a new one (1 wallet per agent).
  if (bot.agentPublicKey) {
    return NextResponse.json({
      ok: true,
      walletAddress: bot.agentPublicKey,
      alreadyExisted: true,
    });
  }

  // Generate new keypair & encrypt
  const generated = await generateAgentWallet();

  await db
    .update(userBots)
    .set({
      agentPublicKey: generated.publicKey,
      agentSecretEnc: generated.secretEnc,
      updatedAt: new Date(),
    })
    .where(eq(userBots.id, bot.id));

  return NextResponse.json({
    ok: true,
    walletAddress: generated.publicKey,
    alreadyExisted: false,
  });
}
