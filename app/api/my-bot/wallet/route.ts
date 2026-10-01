import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { userBots } from "@/drizzle/schema";
import { isAgentWalletConfigured } from "@/lib/wallet/secret-encryption";
import { getEffectiveConfig } from "@/lib/sniper/effective-config";
import { getAddressBalance } from "@/lib/solana/wallet";
import { getNativeBalance } from "@/lib/chain/rpc";
import { loadRobinhoodAgentAccountView } from "@/lib/chain/robinhood-agent-wallet-view";

export const dynamic = "force-dynamic";


/** Mirrors LIVE_FEE_HEADROOM_SOL in scripts/paper-daemon.ts: held back from
 * every live buy for the swap fee and the token account rent, so a wallet
 * can always afford to sell back out of what it bought. */
const LIVE_FEE_HEADROOM_SOL = 0.01;

/** Solana-only shape check — for values that must genuinely be a Solana
 * address (e.g. a SOL withdrawal destination below), not the identity
 * wallet. Do not use this for the owner/identity wallet — see
 * isPlausibleWalletAddress. */
function isPlausibleSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/** Loose shape check for the IDENTITY/owner wallet — enough to reject
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
     a valid input to the Solana balance reader below (getAddressBalance
     decodes it as a Solana base58 address, which a 0x-shaped address is
     not) — this branch must run BEFORE that call, never after a failed
     attempt. */
  if (bot.agentChain === "robinhood") {
    // loadRobinhoodAgentAccountView validates agentNetwork BEFORE ever
    // calling getBalance — a network-mismatched bot never triggers a
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

/** Agent-wallet withdrawal — RETIRED/UNAVAILABLE (PR09A).
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
