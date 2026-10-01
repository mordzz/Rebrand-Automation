import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { userBots } from "@/lib/db/schema";
import { isAgentWalletConfigured } from "@/lib/wallet/secret-encryption";
import { getNativeBalance } from "@/lib/chain/rpc";
import { loadRobinhoodAgentAccountView } from "@/lib/chain/robinhood-agent-wallet-view";

export const dynamic = "force-dynamic";



/** Solana-only shape check - for values that must genuinely be a Solana
 * address (e.g. a SOL withdrawal destination below), not the identity
 * wallet. Do not use this for the owner/identity wallet - see
 * isPlausibleWalletAddress. */
function isPlausibleSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/** Loose shape check for the IDENTITY/owner wallet - enough to reject
 * garbage, not full validation. Accepts either a legacy Solana wallet
 * (base58) or a Robinhood/EVM wallet (0x + 40 hex chars): PR02 kept
 * Privy's walletChainType as "ethereum-and-solana", so userBots.walletAddress
 * may legitimately be either shape depending on when the bot was deployed.
 * GET is read-only (address + balance, never key material), so the wallet
 * is client-asserted here; the only mutation (POST withdraw) is retired. */
function isPlausibleWalletAddress(addr: string): boolean {
  return isPlausibleSolanaAddress(addr) || /^0x[0-9a-fA-F]{40}$/.test(addr);
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
  if (!isPlausibleWalletAddress(owner)) {
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

  /* Chain-aware dispatch: a Robinhood/EVM agent wallet's address is never
     read with the Robinhood RPC; legacy Solana wallets below are
     historical and never read live. */
  if (bot.agentChain === "robinhood") {
    // loadRobinhoodAgentAccountView validates agentNetwork BEFORE ever
    // calling getBalance - a network-mismatched bot never triggers a
    // Robinhood RPC read at all.
    const view = await loadRobinhoodAgentAccountView(
      { agentPublicKey: bot.agentPublicKey, agentNetwork: bot.agentNetwork },
      { getBalance: (address) => getNativeBalance(address) }
    );
    if ("reason" in view) {
      return NextResponse.json(view);
    }
    return NextResponse.json({
      configured: true,
      wallet: view,
      tradingMode: bot.tradingMode,
      active: bot.active,
    });
  }

  /* Legacy Solana agent wallet (historical only). The Solana runtime and
     its live RPC reader are retired, so no live balance is read or
     invented: the stored address is returned, balance unknown. */
  return NextResponse.json({
    configured: true,
    wallet: {
      address: bot.agentPublicKey,
      chain: "solana",
      nativeSymbol: "SOL",
      balanceNative: null,
      error: "Historical Solana wallet: live balance is no longer read",
    },
    tradingMode: bot.tradingMode,
    active: bot.active,
  });
}

/** Agent-wallet withdrawal - RETIRED/UNAVAILABLE (PR09A).
 *
 * The Solana withdrawal path (signing with a Solana agent key) is retired
 * with the Solana runtime. Robinhood agent-wallet withdrawal needs the
 * controlled broadcast layer and server-side owner authentication, neither
 * of which exists for withdrawals yet, so this fails closed for every bot. */
export async function POST() {
  return NextResponse.json(
    { error: "Agent-wallet withdrawal is unavailable: the Solana path is retired and Robinhood withdrawal is not implemented yet." },
    { status: 501 }
  );
}
