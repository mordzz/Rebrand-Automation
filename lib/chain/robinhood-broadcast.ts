/**
 * Robinhood Chain TESTNET broadcaster — PR10.
 *
 * The narrow last step of the execution pipeline:
 *
 *   PR08 builder (robinhood-v4-swap-tx.ts)  → unsigned {chainId,to,data,value}
 *   PR09 signer  (robinhood-agent-signing.ts) → signed raw tx (offline)
 *   PR10 broadcaster (this module)            → eth_sendRawTransaction
 *
 * It sends exactly one already-signed raw transaction and nothing else —
 * it cannot build, alter, or sign anything. Before sending it independently
 * re-derives what the raw bytes actually do and refuses unless ALL match
 * what the caller intended:
 *
 *   - chain id is Robinhood TESTNET (46630) — hard-coded, no env flag; the
 *     process must also be on testnet and the RPC must report 46630
 *   - recovered sender == the bot's agent wallet
 *   - `to`, `value`, and calldata == the PR08 unsigned transaction exactly
 *   - nonce/gas/fees == what the PR09 signer reported
 *
 * Idempotency / rebroadcast safety:
 *   - the tx hash is keccak256(raw), computed BEFORE sending, and handed to
 *     `persistBeforeSend` — the caller records it durably first, so a crash
 *     mid-send can always be reconciled by hash, never blindly re-signed
 *   - if the hash is already known to the node, it is NOT resent
 *   - if the sender's confirmed nonce has already moved past this tx's nonce
 *     and the hash is unknown, the nonce was consumed by a different tx —
 *     refused, never "retried" (that would be a replacement, not a resend)
 *
 * MAINNET: not implemented. Fails closed before any RPC call.
 */
import {
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

import { ROBINHOOD_CHAIN_ID, ROBINHOOD_CHAIN_IDS, ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { assertCorrectChain, getRobinhoodPublicClient } from "@/lib/chain/rpc";
import type { SignedRobinhoodTransaction } from "@/lib/chain/robinhood-agent-signing";
import type { UnsignedTransaction } from "@/lib/chain/robinhood-v4-swap-tx";

/** The only chain this module will ever broadcast to. */
export const BROADCAST_CHAIN_ID = ROBINHOOD_CHAIN_IDS.testnet;

export type BroadcastRecord = {
  hash: Hex;
  chainId: number;
  sender: Address;
  to: Address;
  nonce: number;
  value: bigint;
  signedRawTransaction: Hex;
};

export type BroadcastInput = {
  /** The bot's agent wallet address — must be the recovered signer. */
  expectedSender: Address;
  /** The PR08 transaction the signer was asked to sign. */
  unsignedTransaction: UnsignedTransaction;
  /** The PR09 signer's output for exactly that transaction. */
  signed: SignedRobinhoodTransaction;
  /** Must durably record the hash (and raw tx) before sending. Throwing
   * aborts the broadcast. */
  persistBeforeSend: (record: BroadcastRecord) => Promise<void>;
};

export type BroadcastResult = {
  hash: Hex;
  /** True when the node already knew this exact tx — it was not resent. */
  alreadyKnown: boolean;
};

export type BroadcastDeps = {
  client?: Pick<PublicClient, "getTransaction" | "getTransactionCount" | "sendRawTransaction">;
  assertNetwork?: () => Promise<void>;
};

export function assertTestnetBroadcastEnabled(): void {
  if (ROBINHOOD_NETWORK !== "testnet" || ROBINHOOD_CHAIN_ID !== BROADCAST_CHAIN_ID) {
    throw new Error("Robinhood mainnet broadcasting is not enabled");
  }
}

/**
 * Pure verification of a signed raw transaction against the caller's
 * intent. No RPC. Returns the record (with the precomputed hash) to send.
 */
export async function verifySignedTransaction(
  input: Pick<BroadcastInput, "expectedSender" | "unsignedTransaction" | "signed">,
): Promise<BroadcastRecord> {
  assertTestnetBroadcastEnabled();
  const { signed, unsignedTransaction: unsigned } = input;
  const raw = signed.signedRawTransaction;

  let parsed: ReturnType<typeof parseTransaction>;
  try {
    parsed = parseTransaction(raw);
  } catch (error) {
    throw new Error(`broadcast: signed transaction does not parse: ${error instanceof Error ? error.message : String(error)}`);
  }

  // viem's parseTransaction omits zero-valued RLP fields (e.g. a 0 priority
  // fee on Robinhood's L2, nonce 0, value 0) — treat absent as zero.
  const n = (v: bigint | undefined) => v ?? BigInt(0);

  const fail = (what: string) => {
    throw new Error(`broadcast: refusing — ${what}`);
  };

  if (parsed.type !== "eip1559") fail(`tx type is ${parsed.type}, expected eip1559`);
  if (parsed.chainId !== BROADCAST_CHAIN_ID) fail(`chainId ${parsed.chainId} is not Robinhood testnet (${BROADCAST_CHAIN_ID})`);
  if (unsigned.chainId !== BROADCAST_CHAIN_ID || signed.chainId !== BROADCAST_CHAIN_ID) {
    fail("unsigned/signed chainId is not Robinhood testnet");
  }
  if (!parsed.to || getAddress(parsed.to) !== getAddress(unsigned.to)) fail(`target ${parsed.to} != intended ${unsigned.to}`);
  if (getAddress(signed.to) !== getAddress(unsigned.to)) fail("signer-reported target differs from intended target");
  if (n(parsed.value) !== unsigned.value) fail(`value ${parsed.value ?? 0} != intended ${unsigned.value}`);
  if (signed.value !== unsigned.value) fail("signer-reported value differs from intended value");
  if ((parsed.data ?? "0x").toLowerCase() !== unsigned.data.toLowerCase()) fail("calldata differs from the intended calldata");
  if ((parsed.nonce ?? 0) !== signed.nonce) fail(`nonce ${parsed.nonce} != signer-reported ${signed.nonce}`);
  if (n(parsed.gas) !== signed.gas) fail("gas limit differs from signer-reported gas");
  if (n(parsed.maxFeePerGas) !== signed.maxFeePerGas || n(parsed.maxPriorityFeePerGas) !== signed.maxPriorityFeePerGas) {
    fail("fee fields differ from signer-reported fees");
  }

  const sender = await recoverTransactionAddress({
    serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"],
  });
  if (getAddress(sender) !== getAddress(input.expectedSender)) {
    fail(`recovered sender ${sender} is not the agent wallet ${input.expectedSender}`);
  }

  return {
    hash: keccak256(raw),
    chainId: BROADCAST_CHAIN_ID,
    sender: getAddress(sender),
    to: getAddress(unsigned.to),
    nonce: signed.nonce,
    value: unsigned.value,
    signedRawTransaction: raw,
  };
}

async function isKnown(client: NonNullable<BroadcastDeps["client"]>, hash: Hex): Promise<boolean> {
  try {
    await client.getTransaction({ hash });
    return true;
  } catch {
    return false;
  }
}

/** Verifies, persists, and sends one signed testnet transaction. */
export async function broadcastRobinhoodTransaction(
  input: BroadcastInput,
  deps: BroadcastDeps = {},
): Promise<BroadcastResult> {
  const record = await verifySignedTransaction(input);

  const client = deps.client ?? getRobinhoodPublicClient();
  const assertNetwork = deps.assertNetwork ?? (() => assertCorrectChain(getRobinhoodPublicClient()));
  await assertNetwork();

  if (await isKnown(client, record.hash)) {
    return { hash: record.hash, alreadyKnown: true };
  }

  const confirmedNonce = await client.getTransactionCount({ address: record.sender, blockTag: "latest" });
  if (confirmedNonce > record.nonce) {
    throw new Error(
      `broadcast: refusing — nonce ${record.nonce} was already consumed by a different transaction ` +
        `(confirmed nonce ${confirmedNonce}); re-sign from fresh state instead of rebroadcasting`,
    );
  }

  await input.persistBeforeSend(record);

  try {
    const sentHash = await client.sendRawTransaction({ serializedTransaction: record.signedRawTransaction });
    if (sentHash.toLowerCase() !== record.hash.toLowerCase()) {
      throw new Error(`broadcast: node returned hash ${sentHash}, expected ${record.hash}`);
    }
    return { hash: record.hash, alreadyKnown: false };
  } catch (error) {
    // "already known" / a lost response: the tx may be in the pool anyway.
    if (await isKnown(client, record.hash)) return { hash: record.hash, alreadyKnown: true };
    throw error;
  }
}

export type ConfirmedReceipt =
  | { status: "success"; receipt: TransactionReceipt }
  | { status: "reverted"; receipt: TransactionReceipt }
  | { status: "unexpected"; receipt: TransactionReceipt; detail: string };

/**
 * Waits for the receipt and checks it is the transaction we sent: mined on
 * testnet, from the agent wallet, to the intended target. Only
 * `receipt.status === "success"` counts as success.
 */
export async function waitForRobinhoodReceipt(
  record: Pick<BroadcastRecord, "hash" | "sender" | "to">,
  options: { timeoutMs?: number; client?: Pick<PublicClient, "waitForTransactionReceipt"> } = {},
): Promise<ConfirmedReceipt> {
  assertTestnetBroadcastEnabled();
  const client = options.client ?? getRobinhoodPublicClient();
  const receipt = await client.waitForTransactionReceipt({
    hash: record.hash,
    timeout: options.timeoutMs ?? 120_000,
  });
  if (getAddress(receipt.from) !== getAddress(record.sender)) {
    return { status: "unexpected", receipt, detail: `receipt.from ${receipt.from} != ${record.sender}` };
  }
  if (!receipt.to || getAddress(receipt.to) !== getAddress(record.to)) {
    return { status: "unexpected", receipt, detail: `receipt.to ${receipt.to} != ${record.to}` };
  }
  return receipt.status === "success" ? { status: "success", receipt } : { status: "reverted", receipt };
}
