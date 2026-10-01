import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { assertNotOfficial } from "@/lib/db/official-bot";
import { userBots } from "@/lib/db/schema";
import { isAgentWalletConfigured } from "@/lib/wallet/secret-encryption";
import { generateRobinhoodAgentWallet } from "@/lib/chain/robinhood-agent-wallet";
import { authErrorResponse, authenticateEvmOwner } from "@/lib/auth/privy-server";

export const dynamic = "force-dynamic";

/** Loose shape check for the identity/owner wallet - enough to reject
 * garbage, not full validation. Accepts either a legacy Solana wallet
 * (base58) or a Robinhood/EVM wallet (0x + 40 hex chars): PR02 kept
 * Privy's walletChainType as "ethereum-and-solana", so userBots.walletAddress
 * may legitimately be either shape depending on when the bot was deployed.
 * GET is read-only and strips key material; POST (which can mint an agent
 * wallet) requires a verified Privy access token that owns the wallet. */
function isPlausibleWalletAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr) || /^0x[0-9a-fA-F]{40}$/.test(addr);
}

const CHARACTER_TYPES = new Set(["3d", "image", "gif"]);

/** Drops the encrypted agent key from anything sent to a browser. This
 * endpoint's GET trusts a client-asserted wallet, so shipping key material -
 * even encrypted - would put it one guessed address away from anyone who
 * later obtains the encryption key. */
function withoutSecret<T extends { agentSecretEnc?: string | null }>(row: T) {
  const copy = { ...row };
  delete copy.agentSecretEnc;
  return copy;
}

/** The caller's deployed automaton, if any. */
export async function GET(request: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ configured: false, bot: null });

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleWalletAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const [bot] = await db
    .select()
    .from(userBots)
    .where(eq(userBots.walletAddress, wallet))
    .limit(1);

  if (!bot) return NextResponse.json({ configured: true, bot: null });

  /* Strip the encrypted agent key before it leaves the server. It is
     encrypted, but this GET trusts a client-asserted wallet, so
     shipping it would put every agent's key material one guessed address
     away from an attacker who later obtains the encryption key. */
  return NextResponse.json({ configured: true, bot: withoutSecret(bot) });
}

/** Creates or updates the caller's automaton (name + character).
 *
 * PR09C: requires `Authorization: Bearer <Privy access token>` whose
 * authoritative Privy user has `wallet` linked as an EVM account - checked
 * before any DB read or key generation. Only EVM owners can deploy/refit;
 * legacy Solana-owned bots stay in the DB untouched (read-only via GET). */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  let body: {
    wallet?: string;
    name?: string;
    characterType?: string;
    characterSrc?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const wallet = body.wallet ?? "";
  const auth = await authenticateEvmOwner(request, wallet);
  if (!auth.ok) return authErrorResponse(auth);

  const name = (body.name ?? "").trim().slice(0, 40);
  const characterType = body.characterType ?? "";
  const characterSrc = body.characterSrc?.trim() || null;

  if (name.length < 2) {
    return NextResponse.json({ error: "Name too short" }, { status: 400 });
  }
  if (!CHARACTER_TYPES.has(characterType)) {
    return NextResponse.json({ error: "Invalid character type" }, { status: 400 });
  }
  if (characterType !== "3d" && !characterSrc) {
    return NextResponse.json({ error: "Character image URL required" }, { status: 400 });
  }
  if (characterSrc && !/^(https?:\/\/|\/)/.test(characterSrc)) {
    return NextResponse.json({ error: "Character URL must be http(s) or local" }, { status: 400 });
  }

  /* Give a first-time deploy its own trading wallet. Only when one is
     missing: a refit re-POSTs this route, and minting a fresh keypair
     there would orphan whatever the operator had already deposited into
     the old address. Skipped entirely when no encryption key is set -
     lib/wallet/secret-encryption.ts refuses to store a secret in the clear,
     and a bot with no wallet is recoverable while a leaked key is not. */
  const [existing] = await db
    .select()
    .from(userBots)
    .where(eq(userBots.walletAddress, wallet))
    .limit(1);

  const blocked = assertNotOfficial(existing ?? null);
  if (blocked) return blocked;

  let agentPublicKey = existing?.agentPublicKey ?? null;
  let agentSecretEnc = existing?.agentSecretEnc ?? null;
  let agentChain = existing?.agentChain ?? null;
  let agentNetwork = existing?.agentNetwork ?? null;
  let agentNativeSymbol = existing?.agentNativeSymbol ?? null;
  if (!agentPublicKey && isAgentWalletConfigured()) {
    const generated = await generateRobinhoodAgentWallet();
    agentPublicKey = generated.address;
    agentSecretEnc = generated.secretEnc;
    agentChain = generated.chain;
    agentNetwork = generated.network;
    agentNativeSymbol = generated.nativeSymbol;
  }

  const [bot] = await db
    .insert(userBots)
    .values({
      walletAddress: wallet,
      name,
      characterType,
      characterSrc,
      agentPublicKey,
      agentSecretEnc,
      agentChain,
      agentNetwork,
      agentNativeSymbol,
    })
    .onConflictDoUpdate({
      target: userBots.walletAddress,
      set: {
        name,
        characterType,
        characterSrc,
        updatedAt: new Date(),
        // If the existing bot had no wallet, save the newly generated one
        ...(agentPublicKey && !existing?.agentPublicKey
          ? { agentPublicKey, agentSecretEnc, agentChain, agentNetwork, agentNativeSymbol }
          : {}),
      },
    })
    .returning();

  // Never hand the encrypted secret to the client.
  return NextResponse.json({ configured: true, bot: withoutSecret(bot) });
}
