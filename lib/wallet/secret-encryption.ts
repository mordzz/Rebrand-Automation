// Server-only module. Holds the chain-neutral encryption-at-rest
// implementation for agent trading-wallet secrets — no Solana or EVM
// assumption anywhere in this file — and must never be imported from a
// client component.
//
// Extracted from lib/solana/agent-wallet.ts (PR09 hardening) so both the
// legacy Solana agent-wallet path and the Robinhood/EVM agent-wallet path
// (lib/chain/robinhood-agent-wallet.ts) share exactly one AES-256-GCM
// implementation, never two independently-maintained copies. The
// encryption format is UNCHANGED by this move — an existing encrypted
// secret produced before this extraction remains decryptable by this
// module exactly as it was by lib/solana/agent-wallet.ts.
import * as crypto from "node:crypto";

/* ── Encryption at rest ──────────────────────────────────────────────────
 *
 * An agent wallet's secret key is the one thing in this system that can
 * move a user's money without them present, so it is never stored raw.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt
 * rather than silently producing a wrong key. The encryption key lives in
 * the environment, never in the database — otherwise a database dump
 * alone would be enough to drain every agent wallet, which is exactly the
 * failure this is here to prevent.
 */

const ENC_VERSION = "v1";

function encryptionKey(): Buffer | null {
  const raw = process.env.AGENT_WALLET_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  // Accept hex or base64; both must decode to exactly 32 bytes.
  const buf = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export function isAgentWalletConfigured(): boolean {
  return encryptionKey() !== null;
}

/** Refuses rather than falling back to plaintext: a wallet stored in the
 * clear is worse than a wallet that could not be created. */
function requireKey(): Buffer {
  const key = encryptionKey();
  if (!key) {
    throw new Error(
      "AGENT_WALLET_ENCRYPTION_KEY is not set to a 32-byte hex or base64 value"
    );
  }
  return key;
}

/** Encrypts opaque secret bytes — a Solana 64-byte keypair seed, an EVM
 * 32-byte private key, or anything else a future chain's agent wallet
 * needs to store. This module has no opinion on what the bytes mean. */
export function encryptSecret(secret: Uint8Array): string {
  const key = requireKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENC_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptSecret(stored: string): Uint8Array {
  const key = requireKey();
  const [version, ivB64, tagB64, dataB64] = stored.split(".");
  if (version !== ENC_VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored agent key is not in the expected format");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return new Uint8Array(
    Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ])
  );
}
