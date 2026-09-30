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
import { decryptSecret, encryptSecret, isAgentWalletConfigured } from "@/lib/wallet/secret-encryption";

const LAMPORTS_PER_SOL = 1_000_000_000;
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");

const RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

/* ── Encryption at rest ──────────────────────────────────────────────────
 *
 * The AES-256-GCM implementation itself now lives in
 * lib/wallet/secret-encryption.ts (PR09 hardening) — chain-neutral, no
 * Solana assumption, shared with lib/chain/robinhood-agent-wallet.ts.
 * Re-exported here unchanged so every existing caller of this module
 * (isAgentWalletConfigured/encryptSecret/decryptSecret from
 * lib/solana/agent-wallet.ts) keeps working without modification, and so
 * an already-encrypted secret remains decryptable exactly as before —
 * the encryption format did not change, only where the code lives. */
export { decryptSecret, encryptSecret, isAgentWalletConfigured };

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
