import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { assertNotOfficial } from "@/lib/db/official-bot";
import { userBots } from "@/drizzle/schema";
import { isAgentWalletConfigured } from "@/lib/wallet/secret-encryption";
import { generateRobinhoodAgentWallet } from "@/lib/chain/robinhood-agent-wallet";
import { authErrorResponse, authenticateEvmOwner } from "@/lib/auth/privy-server";

export const dynamic = "force-dynamic";

/**
 * Generates an agent wallet for an existing automaton that was deployed
 * before AGENT_WALLET_ENCRYPTION_KEY was configured.
 *
 * 1 agent wallet per automaton (account). If a wallet already exists for this
 * automaton, this route is idempotent and returns the existing public key.
 *
 * PR09C: requires a verified Privy access token whose user has `wallet`
 * linked as an EVM account (see lib/auth/privy-server.ts). Checked before
 * any DB read or key generation. Solana agent-wallet generation is retired
 * (PR09A) — a non-EVM wallet is rejected by the auth check itself.
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

  const auth = await authenticateEvmOwner(request, wallet);
  if (!auth.ok) return authErrorResponse(auth);

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
