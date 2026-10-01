import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { authErrorResponse, authenticateEvmOwner } from "@/lib/auth/privy-server";
import { getDb } from "@/lib/db";
import { userBots } from "@/drizzle/schema";
import { openBotLighterSigner } from "@/lib/lighter/bot-credentials";
import { LighterClient } from "@/lib/lighter/client";
import { getLighterConfig } from "@/lib/lighter/config";
import { toPerpAccountView } from "@/lib/lighter/positions";

export const dynamic = "force-dynamic";

/**
 * The bot's Lighter perps state - PR12. Owner-authenticated (a verified
 * Privy user that owns the EVM owner wallet), because reading open orders
 * and personal funding uses the bot's Lighter API key to mint an auth
 * token. Returns public metadata only - never the encrypted API key.
 */
export async function GET(request: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ configured: false }, { status: 503 });
  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  const auth = await authenticateEvmOwner(request, wallet);
  if (!auth.ok) return authErrorResponse(auth);

  const [bot] = await db.select().from(userBots).where(eq(userBots.walletAddress, wallet)).limit(1);
  if (!bot) return NextResponse.json({ error: "No automaton deployed" }, { status: 404 });

  const config = getLighterConfig();
  const lighter = {
    network: config.network,
    ownerAddress: bot.agentPublicKey, // the AGENT wallet owns the Lighter account
    status: bot.lighterApiKeyStatus ?? "not_provisioned",
    accountIndex: bot.lighterAccountIndex,
    apiKeyIndex: bot.lighterApiKeyIndex,
    apiPublicKey: bot.lighterApiPublicKey,
  };
  if (bot.lighterApiKeyStatus !== "registered" || bot.lighterAccountIndex == null) {
    return NextResponse.json({ configured: true, lighter, account: null, openOrders: [], funding: [] });
  }

  const client = new LighterClient(config);
  const signer = await openBotLighterSigner(bot);
  try {
    const token = await signer.createAuthToken(Math.floor(Date.now() / 1000) + 600);
    const [account, openOrders, funding] = await Promise.all([
      client.getAccount(bot.lighterAccountIndex),
      client.getActiveOrders(bot.lighterAccountIndex, token),
      client.getPositionFunding(bot.lighterAccountIndex, token, 20),
    ]);
    return NextResponse.json({ configured: true, lighter, account: toPerpAccountView(account), openOrders, funding });
  } catch (error) {
    return NextResponse.json(
      { configured: true, lighter, error: error instanceof Error ? error.message : "Lighter unavailable" },
      { status: 503 },
    );
  } finally {
    await signer.close();
  }
}
