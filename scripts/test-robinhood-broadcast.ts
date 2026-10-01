/**
 * Deterministic tests for the PR10 Robinhood testnet broadcaster:
 * lib/chain/robinhood-broadcast.ts.
 *
 * No network calls. Signs real transactions with a freshly generated agent
 * wallet through the real PR09 signer (RPC deps injected), then exercises
 * the broadcaster's verification, idempotency and rebroadcast rules
 * against a fake client that records every call.
 *
 * Run: npm run test:robinhood-broadcast
 */
import * as crypto from "node:crypto";
if (!process.env.AGENT_WALLET_ENCRYPTION_KEY?.trim()) {
  process.env.AGENT_WALLET_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { keccak256, type Address, type Hex, type TransactionReceipt } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { generateRobinhoodAgentWallet, type AgentWalletBotRow } from "@/lib/chain/robinhood-agent-wallet";
import { signRobinhoodTransaction, type SignedRobinhoodTransaction } from "@/lib/chain/robinhood-agent-signing";
import {
  BROADCAST_CHAIN_ID,
  broadcastRobinhoodTransaction,
  verifySignedTransaction,
  waitForRobinhoodReceipt,
  type BroadcastDeps,
  type BroadcastRecord,
} from "@/lib/chain/robinhood-broadcast";
import { resolveRobinhoodExecutionConfig } from "@/lib/chain/robinhood-execution-config";
import { buildErc20ApprovalTransaction, type UnsignedTransaction } from "@/lib/chain/robinhood-v4-swap-tx";

let failures = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`[FAIL] ${label}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

async function rejects(fn: () => Promise<unknown>, pattern: RegExp, label: string): Promise<void> {
  try {
    await fn();
    assert(false, `${label} (did not throw)`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    assert(pattern.test(msg), `${label} - ${msg.slice(0, 90)}`);
  }
}

const TOKEN: Address = "0xf0EA05Cd5FD14189b80616eF36bE2caefd389D4E";
const NONCE = 7;

/** Fake RPC client that records calls. */
function fakeClient(opts: { knownBefore?: boolean; knownAfterSendError?: boolean; confirmedNonce?: number; sendError?: Error; returnHash?: Hex }) {
  const log: string[] = [];
  let sent = false;
  const client: NonNullable<BroadcastDeps["client"]> = {
    getTransaction: (async () => {
      log.push("getTransaction");
      const known = sent ? true : opts.knownBefore || (log.includes("send") && opts.knownAfterSendError);
      if (!known) throw new Error("not found");
      return {};
    }) as never,
    getTransactionCount: (async () => {
      log.push("getTransactionCount");
      return opts.confirmedNonce ?? NONCE;
    }) as never,
    sendRawTransaction: (async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      log.push("send");
      if (opts.sendError) throw opts.sendError;
      sent = true;
      return opts.returnHash ?? keccak256(serializedTransaction);
    }) as never,
  };
  return { client, log };
}

async function main() {
  if (ROBINHOOD_NETWORK !== "testnet") {
    console.log("[SKIP] requires NEXT_PUBLIC_ROBINHOOD_NETWORK=testnet");
    return;
  }
  const cfg = resolveRobinhoodExecutionConfig("testnet");
  if (!cfg.ok) throw new Error(cfg.reason);
  const config = cfg.config;

  const wallet = await generateRobinhoodAgentWallet();
  const bot: AgentWalletBotRow = {
    agentChain: "robinhood",
    agentNetwork: wallet.network,
    agentPublicKey: wallet.address,
    agentSecretEnc: wallet.secretEnc,
  };
  const unsigned = buildErc20ApprovalTransaction(config, TOKEN, BigInt(1_000));
  const signed = await signRobinhoodTransaction(
    { bot, unsignedTransaction: unsigned, intent: "erc20_approval", approvalToken: TOKEN },
    {
      assertNetwork: async () => {},
      getNonce: async () => NONCE,
      estimateFeesPerGas: async () => ({ maxFeePerGas: BigInt(2_000_000_000), maxPriorityFeePerGas: BigInt(1_000_000) }),
      estimateGas: async () => BigInt(60_000),
    },
  );
  const base = { expectedSender: wallet.address, unsignedTransaction: unsigned, signed };

  // ═══ Verification ═════════════════════════════════════════════════════
  const record = await verifySignedTransaction(base);
  assert(record.hash === keccak256(signed.signedRawTransaction), "hash precomputed as keccak256(raw)");
  assert(record.sender === wallet.address, "recovered sender is the agent wallet");
  assert(record.chainId === 46630 && BROADCAST_CHAIN_ID === 46630, "broadcast chain is Robinhood testnet 46630");

  const other = privateKeyToAccount(generatePrivateKey()).address;
  await rejects(() => verifySignedTransaction({ ...base, expectedSender: other }), /recovered sender/, "wrong expected sender refused");
  await rejects(
    () => verifySignedTransaction({ ...base, unsignedTransaction: { ...unsigned, to: config.permit2 } }),
    /target/,
    "tampered target refused",
  );
  await rejects(
    () => verifySignedTransaction({ ...base, unsignedTransaction: { ...unsigned, value: BigInt(1) } }),
    /value/,
    "tampered value refused",
  );
  await rejects(
    () => verifySignedTransaction({ ...base, unsignedTransaction: { ...unsigned, data: `${unsigned.data}00` as Hex } }),
    /calldata/,
    "calldata with trailing byte refused",
  );
  await rejects(
    () => verifySignedTransaction({ ...base, signed: { ...signed, nonce: NONCE + 1 } }),
    /nonce/,
    "signer-reported nonce mismatch refused",
  );
  await rejects(
    () => verifySignedTransaction({ ...base, signed: { ...signed, gas: BigInt(1) } }),
    /gas/,
    "gas mismatch refused",
  );
  await rejects(
    () => verifySignedTransaction({ ...base, signed: { ...signed, signedRawTransaction: "0xdeadbeef" } }),
    /does not parse/,
    "garbage raw tx refused",
  );

  // Regression: Robinhood testnet reports a 0 priority fee, and viem's
  // parseTransaction omits zero-valued fields. Also nonce 0 (fresh wallet).
  {
    const zeroSigned = await signRobinhoodTransaction(
      { bot, unsignedTransaction: unsigned, intent: "erc20_approval", approvalToken: TOKEN },
      {
        assertNetwork: async () => {},
        getNonce: async () => 0,
        estimateFeesPerGas: async () => ({ maxFeePerGas: BigInt(20_000_000), maxPriorityFeePerGas: BigInt(0) }),
        estimateGas: async () => BigInt(60_000),
      },
    );
    const rec = await verifySignedTransaction({ ...base, signed: zeroSigned });
    assert(rec.nonce === 0, "zero priority fee + nonce 0 verifies (zero-valued fields omitted by parser)");
    await rejects(
      () => verifySignedTransaction({ ...base, signed: { ...zeroSigned, maxPriorityFeePerGas: BigInt(1) } }),
      /fee fields/,
      "zero-fee tx still refused if signer-reported fee differs",
    );
  }

  // A validly signed MAINNET transaction must never pass.
  {
    const mainnetKey = generatePrivateKey();
    const acct = privateKeyToAccount(mainnetKey);
    const raw = await acct.signTransaction({
      chainId: 4663, to: unsigned.to, data: unsigned.data, value: BigInt(0), nonce: NONCE,
      gas: signed.gas, maxFeePerGas: signed.maxFeePerGas, maxPriorityFeePerGas: signed.maxPriorityFeePerGas, type: "eip1559",
    });
    const mainnetSigned: SignedRobinhoodTransaction = { ...signed, signedRawTransaction: raw };
    await rejects(
      () => verifySignedTransaction({ expectedSender: acct.address, unsignedTransaction: unsigned, signed: mainnetSigned }),
      /not Robinhood testnet/,
      "mainnet-chainId signed tx refused",
    );
    const mainnetUnsigned: UnsignedTransaction = { ...unsigned, chainId: 4663 };
    await rejects(
      () => verifySignedTransaction({ ...base, unsignedTransaction: mainnetUnsigned }),
      /testnet/,
      "mainnet unsigned chainId refused",
    );
  }

  // ═══ Broadcast: idempotency and ordering ══════════════════════════════
  const noNet = async () => {};
  {
    const { client, log } = fakeClient({});
    const persisted: BroadcastRecord[] = [];
    const r = await broadcastRobinhoodTransaction(
      { ...base, persistBeforeSend: async (rec) => { log.push("persist"); persisted.push(rec); } },
      { client, assertNetwork: noNet },
    );
    assert(!r.alreadyKnown && r.hash === record.hash, "fresh tx is sent, returns precomputed hash");
    assert(log.indexOf("persist") >= 0 && log.indexOf("persist") < log.indexOf("send"), "hash persisted BEFORE send");
    assert(persisted[0]?.signedRawTransaction === signed.signedRawTransaction, "persisted record carries the raw tx");
  }
  {
    const { client, log } = fakeClient({ knownBefore: true });
    let persisted = false;
    const r = await broadcastRobinhoodTransaction(
      { ...base, persistBeforeSend: async () => { persisted = true; } },
      { client, assertNetwork: noNet },
    );
    assert(r.alreadyKnown && !log.includes("send") && !persisted, "already-known tx is NOT resent");
  }
  {
    const { client, log } = fakeClient({ confirmedNonce: NONCE + 1 });
    let persisted = false;
    await rejects(
      () => broadcastRobinhoodTransaction({ ...base, persistBeforeSend: async () => { persisted = true; } }, { client, assertNetwork: noNet }),
      /already consumed/,
      "consumed nonce with unknown hash refused",
    );
    assert(!log.includes("send") && !persisted, "consumed nonce: nothing persisted or sent");
  }
  {
    const { client, log } = fakeClient({});
    await rejects(
      () => broadcastRobinhoodTransaction({ ...base, persistBeforeSend: async () => { throw new Error("db down"); } }, { client, assertNetwork: noNet }),
      /db down/,
      "persist failure aborts the broadcast",
    );
    assert(!log.includes("send"), "persist failure: nothing sent");
  }
  {
    const { client } = fakeClient({ sendError: new Error("already known"), knownAfterSendError: true });
    const r = await broadcastRobinhoodTransaction({ ...base, persistBeforeSend: async () => {} }, { client, assertNetwork: noNet });
    assert(r.alreadyKnown, "send error but tx in pool → reported alreadyKnown, not failed");
  }
  {
    const { client } = fakeClient({ sendError: new Error("insufficient funds") });
    await rejects(
      () => broadcastRobinhoodTransaction({ ...base, persistBeforeSend: async () => {} }, { client, assertNetwork: noNet }),
      /insufficient funds/,
      "genuine send error propagates",
    );
  }
  {
    const { client, log } = fakeClient({});
    await rejects(
      () => broadcastRobinhoodTransaction(
        { ...base, persistBeforeSend: async () => {} },
        { client, assertNetwork: async () => { throw new Error("wrong_chain"); } },
      ),
      /wrong_chain/,
      "RPC chain-id guard runs before any send",
    );
    assert(log.length === 0, "wrong RPC chain: no RPC tx calls at all");
  }
  {
    const { client, log } = fakeClient({ confirmedNonce: NONCE + 1 });
    await rejects(
      () => broadcastRobinhoodTransaction({ ...base, expectedSender: other, persistBeforeSend: async () => {} }, { client, assertNetwork: noNet }),
      /recovered sender/,
      "verification precedes RPC",
    );
    assert(log.length === 0, "failed verification: no RPC calls");
  }

  // ═══ Receipt confirmation ═════════════════════════════════════════════
  const mkReceipt = (o: Partial<TransactionReceipt>) =>
    ({ status: "success", from: wallet.address, to: unsigned.to, ...o }) as TransactionReceipt;
  const waitWith = (receipt: TransactionReceipt) =>
    waitForRobinhoodReceipt(record, { client: { waitForTransactionReceipt: (async () => receipt) as never } });
  assert((await waitWith(mkReceipt({}))).status === "success", "receipt success from agent to target");
  assert((await waitWith(mkReceipt({ status: "reverted" }))).status === "reverted", "reverted receipt is not success");
  assert((await waitWith(mkReceipt({ from: other }))).status === "unexpected", "receipt from another sender is unexpected");
  assert((await waitWith(mkReceipt({ to: config.permit2 }))).status === "unexpected", "receipt to another target is unexpected");

  // ═══ Static guarantees ════════════════════════════════════════════════
  const src = readFileSync(join(process.cwd(), "lib/chain/robinhood-broadcast.ts"), "utf8");
  assert(!/loadRobinhoodAgentAccount|decryptSecret|signTransaction\(/.test(src), "broadcaster never touches key material");
  assert(!/process\.env/.test(src), "no env flag can enable mainnet broadcasting");

  console.log(failures === 0 ? "\nAll broadcaster tests passed." : `\n${failures} failure(s).`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
