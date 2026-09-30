import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { assertNotOfficial } from "@/lib/db/official-bot";
import { userBots } from "@/lib/db/schema";
import {
  generateAgentWallet,
  isAgentWalletConfigured,
} from "@/lib/solana/agent-wallet";
import { generateRobinhoodAgentWallet } from "@/lib/chain/robinhood-agent-wallet";

export const dynamic = "force-dynamic";

/** Accepts either a legacy Solana wallet (base58) or a Robinhood/EVM
 * wallet (0x + 40 hex chars) — see app/api/my-bot/route.ts. */
function isPlausibleWalletAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr) || /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/** Same chain dispatch as app/api/my-bot/route.ts — never inferred any
 * other way. */
function isEvmOwnerWallet(wallet: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(wallet);
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

  if (!isPlausibleWalletAddress(wallet)) {
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
  const blocked = assertNotOfficial(bot);
  if (blocked) return blocked;

  // If the agent already has a wallet, do not generate a new one (1 wallet per agent).
  if (bot.agentPublicKey) {
    return NextResponse.json({
      ok: true,
      walletAddress: bot.agentPublicKey,
      alreadyExisted: true,
    });
  }

  // Generate new keypair & encrypt — chain dispatch by owner wallet shape,
  // same rule as app/api/my-bot/route.ts.
  if (isEvmOwnerWallet(wallet)) {
    const generated = await generateRobinhoodAgentWallet();
    await db
      .update(userBots)
      .set({
        agentPublicKey: generated.address,
        agentSecretEnc: generated.secretEnc,
        agentChain: generated.chain,
        agentNetwork: generated.network,
        agentNativeSymbol: generated.nativeSymbol,
        updatedAt: new Date(),
      })
      .where(eq(userBots.id, bot.id));

    return NextResponse.json({
      ok: true,
      walletAddress: generated.address,
      alreadyExisted: false,
    });
  }

  const generated = await generateAgentWallet();

  await db
    .update(userBots)
    .set({
      agentPublicKey: generated.publicKey,
      agentSecretEnc: generated.secretEnc,
      agentChain: "solana",
      agentNetwork: null,
      agentNativeSymbol: "SOL",
      updatedAt: new Date(),
    })
    .where(eq(userBots.id, bot.id));

  return NextResponse.json({
    ok: true,
    walletAddress: generated.publicKey,
    alreadyExisted: false,
  });
}
