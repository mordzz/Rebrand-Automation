// Server-only module. Holds the key material for per-agent trading
// wallets and must never be imported from a client component.
import * as crypto from "node:crypto";

import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  assertIsTransactionWithinSizeLimit,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
} from "@solana/kit";

import { sendAndConfirmOverHttp } from "@/lib/solana/confirm";

const LAMPORTS_PER_SOL = 1_000_000_000;
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");

const RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

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

/** Exported (not just used internally) so the chain-neutral parts of this
 * encryption layer can be reused by lib/chain/robinhood-agent-wallet.ts
 * for EVM agent keys — this function only ever handles opaque bytes, it
 * has no Solana-specific assumption in it. Do not duplicate this AES-256-GCM
 * implementation elsewhere; one encryption implementation, reused across
 * chains. */
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

/* ── Wallet lifecycle ────────────────────────────────────────────────── */

export type GeneratedAgentWallet = {
  publicKey: string;
  /** Encrypted blob, safe to persist. Never the raw key. */
  secretEnc: string;
};

/**
 * Creates a fresh Solana keypair for one deployed agent.
 *
 * Deliberately a brand-new wallet rather than anything derived from the
 * operator's own: the operator's Phantom keys are never requested,
 * never held, and never at risk here. Only what they choose to deposit
 * into this address is ever exposed.
 */
export async function generateAgentWallet(): Promise<GeneratedAgentWallet> {
  const keyPair = await crypto.webcrypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const pkcs8 = new Uint8Array(
    await crypto.webcrypto.subtle.exportKey("pkcs8", (keyPair as CryptoKeyPair).privateKey)
  );
  const rawPublic = new Uint8Array(
    await crypto.webcrypto.subtle.exportKey("raw", (keyPair as CryptoKeyPair).publicKey)
  );

  // Solana's 64-byte secret format is seed || publicKey. The seed is the
  // last 32 bytes of the PKCS#8 encoding for Ed25519.
  const seed = pkcs8.slice(-32);
  const secret64 = new Uint8Array(64);
  secret64.set(seed, 0);
  secret64.set(rawPublic, 32);

  const signer = await createKeyPairSignerFromBytes(secret64);

  return { publicKey: signer.address, secretEnc: encryptSecret(secret64) };
}

/** Address for a stored wallet, without exposing the key. */
export async function agentAddressFromSecret(secretEnc: string): Promise<string> {
  const signer = await createKeyPairSignerFromBytes(decryptSecret(secretEnc));
  return signer.address;
}

/* ── Transfers out ───────────────────────────────────────────────────── */

function encodeTransferInstructionData(lamports: bigint): Uint8Array {
  // System program: instruction index 2 (Transfer), then u64 LE lamports.
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return data;
}

export type WithdrawResult = {
  signature: string;
  destination: string;
  amountSol: number;
};

/**
 * Moves SOL out of an agent wallet.
 *
 * Performs no authorization of its own — the caller must already have
 * established that the requester owns this agent. It does enforce the
 * mechanical limits: a positive amount, and enough left behind to cover
 * the fee so a "withdraw everything" cannot fail after the balance check.
 */
export async function withdrawFromAgentWallet(
  secretEnc: string,
  destination: string,
  amountSol: number
): Promise<WithdrawResult> {
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    throw new Error("Amount must be greater than zero");
  }

  const signer = await createKeyPairSignerFromBytes(decryptSecret(secretEnc));
  const destinationAddress = address(destination);
  const lamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));

  const instruction: Instruction = {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: signer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: destinationAddress, role: AccountRole.WRITABLE },
    ],
    data: encodeTransferInstructionData(lamports),
  };

  const rpc = createSolanaRpc(RPC_URL);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(instruction, m)
  );

  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  assertIsTransactionWithinSizeLimit(signed);

  const signature = await sendAndConfirmOverHttp(rpc, signed);

  return { signature, destination, amountSol };
}
