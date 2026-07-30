import * as crypto from "node:crypto";

import { getBase58Encoder } from "@solana/kit";

/**
 * Verifies that a message was signed by the holder of a Solana address.
 *
 * This is the only thing standing between "I typed someone's wallet
 * address into a query string" and "I hold their agent's private key".
 * Every other /api/my-bot route trusts the address as asserted, which is
 * survivable for reading stats or flipping a switch — it is not survivable
 * for revealing key material, so that route requires proof instead.
 */

/** DER prefixes for raw Ed25519 keys, per RFC 8410. */
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifySolanaSignature(
  addressBase58: string,
  message: Uint8Array,
  signature: Uint8Array
): boolean {
  try {
    const raw = getBase58Encoder().encode(addressBase58);
    // A Solana address is a raw 32-byte Ed25519 public key. Anything else
    // is malformed, not merely unlucky.
    if (raw.length !== 32) return false;
    if (signature.length !== 64) return false;

    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(raw)]),
      format: "der",
      type: "spki",
    });

    return crypto.verify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    // Malformed address, signature, or key material — all mean "not proven".
    return false;
  }
}

/* ── Challenge store ─────────────────────────────────────────────────────
 *
 * Nonces are single-use and short-lived: a signature the operator produced
 * once must not stay redeemable, or a signature captured from logs or a
 * browser extension would remain a standing key to the wallet.
 *
 * In-process rather than in the database on purpose — these are worthless
 * seconds after issue, and keeping them out of persistent storage means
 * there is nothing here for a database dump to replay.
 */

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const MAX_CHALLENGES = 500;

type Challenge = { wallet: string; expiresAt: number };
const challenges = new Map<string, Challenge>();

function prune(now: number): void {
  for (const [nonce, c] of challenges) {
    if (c.expiresAt <= now) challenges.delete(nonce);
  }
  while (challenges.size > MAX_CHALLENGES) {
    const oldest = challenges.keys().next().value;
    if (oldest == null) break;
    challenges.delete(oldest);
  }
}

/** Single source of truth for the signed text. Issue and verify must
 * build it identically — if these ever drift, every signature silently
 * fails to verify, so there is exactly one implementation. */
function challengeMessage(wallet: string, nonce: string): string {
  return [
    "Noah Engine — reveal agent wallet private key",
    "",
    "Signing this proves you own this wallet and reveals the private key",
    "of your agent's trading wallet. Anyone holding that key can move its",
    "funds. Only continue if you asked for this.",
    "",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export function issueChallenge(wallet: string): { nonce: string; message: string } {
  const now = Date.now();
  prune(now);

  const nonce = crypto.randomBytes(24).toString("hex");
  challenges.set(nonce, { wallet, expiresAt: now + CHALLENGE_TTL_MS });

  /* The message states plainly what signing authorises. A wallet prompt
     that just shows opaque bytes teaches operators to approve anything. */
  return { nonce, message: challengeMessage(wallet, nonce) };
}

/** Consumes a nonce. Returns the message that was meant to be signed, or
 * null when the nonce is unknown, expired, already used, or belongs to a
 * different wallet. Single-use: it is deleted whether or not the caller
 * goes on to produce a valid signature. */
export function consumeChallenge(nonce: string, wallet: string): string | null {
  const now = Date.now();
  const found = challenges.get(nonce);
  challenges.delete(nonce);

  if (!found || found.expiresAt <= now || found.wallet !== wallet) return null;

  return challengeMessage(wallet, nonce);
}
