import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getBase58Decoder } from "@solana/kit";

import { getDb } from "@/lib/db";
import { assertNotOfficial } from "@/lib/db/official-bot";
import { userBots } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/solana/agent-wallet";
import {
  consumeChallenge,
  issueChallenge,
  verifySolanaSignature,
} from "@/lib/solana/verify-signature";

export const dynamic = "force-dynamic";

function isPlausibleSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

async function loadBot(owner: string) {
  const db = getDb();
  if (!db) return null;
  const [bot] = await db
    .select()
    .from(userBots)
    .where(eq(userBots.walletAddress, owner))
    .limit(1);
  return bot ?? null;
}

/**
 * Exports an agent wallet's private key so the operator can import it into
 * Phantom.
 *
 * This is the one route in the app that hands out key material, so unlike
 * its siblings it does not trust the `?wallet=` parameter. The operator
 * must sign a single-use challenge with the Phantom wallet that owns the
 * bot; without that signature the address in the query string proves
 * nothing, and anyone who read an address off the public fleet page could
 * drain that agent.
 *
 * Exporting is deliberately supported rather than blocked: the wallet was
 * generated for this operator and funded with their money. A wallet whose
 * key they can never hold is custody, not ownership.
 *
 * GET  — issue a challenge to sign
 * POST — redeem { nonce, signature } for the key
 */
export async function GET(request: Request) {
  const owner = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleSolanaAddress(owner)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const bot = await loadBot(owner);
  if (!bot?.agentSecretEnc) {
    return NextResponse.json({ error: "This agent has no wallet." }, { status: 404 });
  }
  const blockedGet = assertNotOfficial(bot);
  if (blockedGet) return blockedGet;

  return NextResponse.json(issueChallenge(owner));
}

export async function POST(request: Request) {
  const owner = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleSolanaAddress(owner)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  let body: { nonce?: string; signature?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nonce = (body.nonce ?? "").trim();
  const signatureB64 = (body.signature ?? "").trim();
  if (!nonce || !signatureB64) {
    return NextResponse.json({ error: "Missing nonce or signature." }, { status: 400 });
  }

  // Consumed first, so a failed attempt burns the nonce rather than
  // leaving it open to be brute-forced against.
  const message = consumeChallenge(nonce, owner);
  if (!message) {
    return NextResponse.json(
      { error: "This request expired or was already used. Try again." },
      { status: 400 }
    );
  }

  /* base64, not base58: the browser encodes it with built-in btoa rather
     than pulling a base58 library into the client bundle for one call. */
  let signature: Uint8Array;
  try {
    signature = new Uint8Array(Buffer.from(signatureB64, "base64"));
  } catch {
    return NextResponse.json({ error: "Malformed signature." }, { status: 400 });
  }

  const proven = verifySolanaSignature(
    owner,
    new TextEncoder().encode(message),
    signature
  );
  if (!proven) {
    return NextResponse.json(
      { error: "Signature did not match this wallet." },
      { status: 403 }
    );
  }

  const bot = await loadBot(owner);
  if (!bot?.agentSecretEnc || !bot.agentPublicKey) {
    return NextResponse.json({ error: "This agent has no wallet." }, { status: 404 });
  }
  const blockedPost = assertNotOfficial(bot);
  if (blockedPost) return blockedPost;

  const secret = decryptSecret(bot.agentSecretEnc);

  /* Phantom's "import private key" accepts the base58-encoded 64-byte
     secret — the same form Phantom itself exports. */
  const privateKeyBase58 = getBase58Decoder().decode(secret);

  return NextResponse.json({
    address: bot.agentPublicKey,
    privateKey: privateKeyBase58,
  });
}
