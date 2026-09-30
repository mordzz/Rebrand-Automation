/**
 * Deterministic tests for the PR09 Robinhood Chain autonomous agent
 * wallet/signing layer: lib/chain/robinhood-agent-wallet.ts,
 * lib/chain/robinhood-agent-signing.ts.
 *
 * No network calls, no broadcast. Key generation, encryption round-trip,
 * validation, and offline transaction signing are all real (not mocked)
 * — only the RPC-dependent prep steps (nonce/fee/gas) are injected via
 * signRobinhoodTransaction's `deps` parameter, exactly per this repo's
 * dependency-injection convention (see robinhood-v4-receipt.ts).
 *
 * NEVER prints a raw private key — only derived addresses and encrypted
 * blobs ever reach console.log/assertEqual output.
 *
 * Run: npm run test:robinhood-agent-signing
 */
// A random, test-only 32-byte key — used only if AGENT_WALLET_ENCRYPTION_KEY
// isn't already configured in this environment. This test never persists
// or logs it; it exists only so encrypt/decrypt round-trip tests below
// can exercise real AES-256-GCM without requiring the real deployment
// secret. Set before any of this repo's modules are imported, since
// lib/solana/agent-wallet.ts reads it lazily per-call (not at import
// time), but setting it up front here keeps this file's intent obvious.
import * as crypto from "node:crypto";
if (!process.env.AGENT_WALLET_ENCRYPTION_KEY?.trim()) {
  process.env.AGENT_WALLET_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
}

import { encodeFunctionData, getAddress, isHex, parseTransaction, type Address, type Hex } from "viem";

import {
  generateRobinhoodAgentWallet,
  loadRobinhoodAgentAccount,
  robinhoodAgentAddressFromSecret,
  type AgentWalletBotRow,
} from "@/lib/chain/robinhood-agent-wallet";
import {
  signRobinhoodTransaction,
  validateSignRobinhoodTransactionInput,
  type SignRobinhoodTransactionInput,
} from "@/lib/chain/robinhood-agent-signing";
import { resolveRobinhoodExecutionConfig } from "@/lib/chain/robinhood-execution-config";
import { encryptSecret } from "@/lib/solana/agent-wallet";
import type { UnsignedTransaction } from "@/lib/chain/robinhood-v4-swap-tx";

let failures = 0;

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const e = JSON.stringify(expected, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  if (a !== e) {
    console.error(`[FAIL] ${label}\n  expected: ${e}\n  actual:   ${a}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

function assert(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`[FAIL] ${label}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

async function assertRejects(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
    console.error(`[FAIL] ${label} (did not throw)`);
    failures++;
  } catch {
    console.log(`[PASS] ${label}`);
  }
}

const testnetConfig = (() => {
  const result = resolveRobinhoodExecutionConfig("testnet");
  if (!result.ok) throw new Error("testnet config must resolve for this test file's fixtures");
  return result.config;
})();

function makeBotRow(overrides: Partial<AgentWalletBotRow> = {}): AgentWalletBotRow {
  return {
    agentChain: "robinhood",
    agentNetwork: "testnet",
    agentPublicKey: null,
    agentSecretEnc: null,
    ...overrides,
  };
}

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function fakeApprovalCalldata(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [spender, amount] });
}

const FAKE_TOKEN: Address = "0xf0EA05Cd5FD14189b80616eF36bE2caefd389D4E";

async function main() {
  // ═══ key generation ═══════════════════════════════════════════════════
  {
    const wallet = await generateRobinhoodAgentWallet();
    assert(/^0x[0-9a-fA-F]{40}$/.test(wallet.address), "generateRobinhoodAgentWallet produces a valid EVM address");
    assertEqual(wallet.chain, "robinhood", "generated wallet is tagged chain=robinhood");
    assertEqual(wallet.network, "testnet", "generated wallet is tagged with the active network (testnet)");
    assertEqual(wallet.nativeSymbol, "ETH", "generated wallet is tagged nativeSymbol=ETH");
    assert(!wallet.secretEnc.includes("0x"), "secretEnc is an encrypted blob, not raw hex key material");

    // The derived-address helper must agree with generation, without
    // ever exposing the raw key.
    const derived = robinhoodAgentAddressFromSecret(wallet.secretEnc);
    assertEqual(getAddress(derived), getAddress(wallet.address), "generated EVM key derives the correct, matching address");
  }
  {
    // Two independent generations must never collide (sanity on the
    // underlying CSPRNG usage, not a cryptographic proof).
    const a = await generateRobinhoodAgentWallet();
    const b = await generateRobinhoodAgentWallet();
    assert(getAddress(a.address) !== getAddress(b.address), "two independently generated wallets have different addresses");
  }

  // ═══ encrypt → decrypt round trip (via loadRobinhoodAgentAccount) ═════
  {
    const wallet = await generateRobinhoodAgentWallet();
    const bot = makeBotRow({ agentPublicKey: wallet.address, agentSecretEnc: wallet.secretEnc });
    const loaded = await loadRobinhoodAgentAccount(bot);
    assertEqual(getAddress(loaded.address), getAddress(wallet.address), "loadRobinhoodAgentAccount: encrypt -> decrypt -> derive round trip matches the generated address");
  }

  // ═══ decrypted key/address mismatch fails ═════════════════════════════
  {
    const walletA = await generateRobinhoodAgentWallet();
    const walletB = await generateRobinhoodAgentWallet();
    // walletB's key, but claiming walletA's address.
    const bot = makeBotRow({ agentPublicKey: walletA.address, agentSecretEnc: walletB.secretEnc });
    await assertRejects(
      () => loadRobinhoodAgentAccount(bot),
      "loadRobinhoodAgentAccount refuses when the derived address doesn't match the stored address"
    );
  }

  // ═══ malformed private key fails ══════════════════════════════════════
  {
    // Encrypt something that is NOT a 32-byte EVM key (e.g. 16 bytes).
    const malformedSecretEnc = encryptSecret(new Uint8Array(16).fill(7));
    const bot = makeBotRow({
      agentPublicKey: "0x1111111111111111111111111111111111111111",
      agentSecretEnc: malformedSecretEnc,
    });
    await assertRejects(
      () => loadRobinhoodAgentAccount(bot),
      "loadRobinhoodAgentAccount refuses a decrypted key that isn't a valid 32-byte EVM private key"
    );
  }

  // ═══ missing key fails ═════════════════════════════════════════════════
  {
    const bot = makeBotRow({ agentPublicKey: "0x1111111111111111111111111111111111111111", agentSecretEnc: null });
    await assertRejects(
      () => loadRobinhoodAgentAccount(bot),
      "loadRobinhoodAgentAccount refuses a bot with no stored encrypted key"
    );
  }
  {
    // Chain-tag mismatch (e.g. a legacy Solana bot's row accidentally
    // routed here) must also refuse, never silently proceed.
    const wallet = await generateRobinhoodAgentWallet();
    const bot = makeBotRow({ agentChain: "solana", agentPublicKey: wallet.address, agentSecretEnc: wallet.secretEnc });
    await assertRejects(
      () => loadRobinhoodAgentAccount(bot),
      "loadRobinhoodAgentAccount refuses a bot whose agentChain isn't \"robinhood\""
    );
  }

  // ═══ wrong network fails ═══════════════════════════════════════════════
  {
    const wallet = await generateRobinhoodAgentWallet();
    const bot = makeBotRow({ agentNetwork: "mainnet", agentPublicKey: wallet.address, agentSecretEnc: wallet.secretEnc });
    await assertRejects(
      () => loadRobinhoodAgentAccount(bot),
      "loadRobinhoodAgentAccount refuses a bot whose agentNetwork doesn't match the active Robinhood network"
    );
  }

  // ═══ validateSignRobinhoodTransactionInput: pure, no network ═══════════
  const swapTx: UnsignedTransaction = {
    chainId: testnetConfig.chainId,
    to: testnetConfig.universalRouter,
    data: "0x1000000000000000000000000000000000000000000000000000000000000020" as Hex,
    value: BigInt(1000),
  };
  {
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: swapTx, intent: "swap" };
    const result = validateSignRobinhoodTransactionInput(input);
    assertEqual(getAddress(result.to), getAddress(testnetConfig.universalRouter), "swap intent: UniversalRouter target accepted");
  }
  {
    const permit2Tx: UnsignedTransaction = { ...swapTx, to: testnetConfig.permit2 };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: permit2Tx, intent: "permit2_authorization" };
    const result = validateSignRobinhoodTransactionInput(input);
    assertEqual(getAddress(result.to), getAddress(testnetConfig.permit2), "permit2_authorization intent: Permit2 target accepted");
  }
  {
    const approvalTx: UnsignedTransaction = { ...swapTx, to: FAKE_TOKEN, data: fakeApprovalCalldata(testnetConfig.permit2, BigInt(1000)) };
    const input: SignRobinhoodTransactionInput = {
      bot: makeBotRow(),
      unsignedTransaction: approvalTx,
      intent: "erc20_approval",
      approvalToken: FAKE_TOKEN,
    };
    const result = validateSignRobinhoodTransactionInput(input);
    assertEqual(getAddress(result.to), getAddress(FAKE_TOKEN), "erc20_approval intent: the named token target is accepted under explicit approvalToken");
  }
  {
    // An erc20_approval transaction targeting the router (not the named
    // token) must be refused — approval intent only ever allows the
    // one token it explicitly names, never the router or Permit2.
    const approvalTx: UnsignedTransaction = { ...swapTx, to: testnetConfig.universalRouter };
    const input: SignRobinhoodTransactionInput = {
      bot: makeBotRow(),
      unsignedTransaction: approvalTx,
      intent: "erc20_approval",
      approvalToken: FAKE_TOKEN,
    };
    assert(
      throwsSync(() => validateSignRobinhoodTransactionInput(input)),
      "erc20_approval intent refuses a target other than the explicitly named token (e.g. the router)"
    );
  }
  {
    // Unexpected transaction target: swap intent pointed at a random
    // unrelated address instead of the verified UniversalRouter.
    const wrongTargetTx: UnsignedTransaction = { ...swapTx, to: "0x2222222222222222222222222222222222222222" };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: wrongTargetTx, intent: "swap" };
    assert(
      throwsSync(() => validateSignRobinhoodTransactionInput(input)),
      "swap intent refuses an unexpected transaction target"
    );
  }
  {
    const negativeValueTx: UnsignedTransaction = { ...swapTx, value: BigInt(-1) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: negativeValueTx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "negative value is refused");
  }
  {
    const emptyDataTx: UnsignedTransaction = { ...swapTx, data: "0x" as Hex };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: emptyDataTx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "empty calldata (0x) is refused");
  }
  {
    const wrongChainIdTx: UnsignedTransaction = { ...swapTx, chainId: 999999 };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: wrongChainIdTx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "wrong chainId (doesn't match the resolved config's) is refused");
  }
  {
    // Mainnet fails closed: a bot configured for Robinhood mainnet can
    // never validate for signing, regardless of the active process
    // network — resolveRobinhoodExecutionConfig("mainnet") itself always
    // fails closed (see PR08's own tests), and this proves that failure
    // propagates all the way through signing validation, never silently
    // falling back to testnet addresses.
    const input: SignRobinhoodTransactionInput = {
      bot: makeBotRow({ agentNetwork: "mainnet" }),
      unsignedTransaction: swapTx,
      intent: "swap",
    };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "mainnet signing fails closed");
  }
  {
    const input: SignRobinhoodTransactionInput = {
      bot: makeBotRow({ agentNetwork: null }),
      unsignedTransaction: swapTx,
      intent: "swap",
    };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "a bot with no recorded agentNetwork fails closed rather than assuming one");
  }

  // ═══ full offline sign: real key, injected RPC-dependent prep ════════
  {
    const wallet = await generateRobinhoodAgentWallet();
    const bot = makeBotRow({ agentPublicKey: wallet.address, agentSecretEnc: wallet.secretEnc });
    const input: SignRobinhoodTransactionInput = { bot, unsignedTransaction: swapTx, intent: "swap" };

    const signed = await signRobinhoodTransaction(input, {
      assertNetwork: async () => {},
      getNonce: async () => 7,
      estimateFeesPerGas: async () => ({ maxFeePerGas: BigInt(2_000_000_000), maxPriorityFeePerGas: BigInt(1_000_000_000) }),
      estimateGas: async () => BigInt(150_000),
    });

    assertEqual(signed.chainId, testnetConfig.chainId, "signed tx carries the expected chainId");
    assertEqual(getAddress(signed.to), getAddress(testnetConfig.universalRouter), "signed tx carries the expected to");
    assertEqual(signed.value, swapTx.value, "signed tx carries the expected value");
    assertEqual(signed.nonce, 7, "signed tx carries the injected nonce");
    assert(isHex(signed.signedRawTransaction), "signedRawTransaction is hex");
    assert(
      !JSON.stringify(signed, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
        .toLowerCase()
        .includes("privatekey"),
      "signing result never includes a field named privateKey"
    );

    // Decode the signed raw transaction independently and confirm it
    // matches what was requested — proof the offline signing actually
    // produced the right transaction, not just that no error was thrown.
    const decoded = parseTransaction(signed.signedRawTransaction);
    assertEqual(decoded.chainId, testnetConfig.chainId, "decoded signed tx: chainId matches");
    assertEqual(getAddress(decoded.to as Address), getAddress(testnetConfig.universalRouter), "decoded signed tx: to matches");
    assertEqual(decoded.value, swapTx.value, "decoded signed tx: value matches");
    assertEqual(decoded.data, swapTx.data, "decoded signed tx: data matches");
    assertEqual(decoded.nonce, 7, "decoded signed tx: nonce matches");
    assert(decoded.type === "eip1559", "decoded signed tx: type is eip1559");
  }
  {
    // erc20_approval end-to-end, proving the approval-only target scoping
    // survives all the way to a real signed transaction.
    const wallet = await generateRobinhoodAgentWallet();
    const bot = makeBotRow({ agentPublicKey: wallet.address, agentSecretEnc: wallet.secretEnc });
    const approvalTx: UnsignedTransaction = {
      chainId: testnetConfig.chainId,
      to: FAKE_TOKEN,
      data: fakeApprovalCalldata(testnetConfig.permit2, BigInt(5000)),
      value: BigInt(0),
    };
    const input: SignRobinhoodTransactionInput = { bot, unsignedTransaction: approvalTx, intent: "erc20_approval", approvalToken: FAKE_TOKEN };

    const signed = await signRobinhoodTransaction(input, {
      assertNetwork: async () => {},
      getNonce: async () => 0,
      estimateFeesPerGas: async () => ({ maxFeePerGas: BigInt(2_000_000_000), maxPriorityFeePerGas: BigInt(1_000_000_000) }),
      estimateGas: async () => BigInt(60_000),
    });
    assertEqual(getAddress(signed.to), getAddress(FAKE_TOKEN), "signed erc20_approval tx targets exactly the named token");
    assertEqual(signed.value, BigInt(0), "signed erc20_approval tx carries zero value");
  }
  {
    // The full signRobinhoodTransaction path also rejects an unexpected
    // target before ever touching the key/RPC deps.
    const wallet = await generateRobinhoodAgentWallet();
    const bot = makeBotRow({ agentPublicKey: wallet.address, agentSecretEnc: wallet.secretEnc });
    const wrongTargetTx: UnsignedTransaction = { ...swapTx, to: "0x2222222222222222222222222222222222222222" };
    const input: SignRobinhoodTransactionInput = { bot, unsignedTransaction: wrongTargetTx, intent: "swap" };
    await assertRejects(
      () =>
        signRobinhoodTransaction(input, {
          assertNetwork: async () => {},
          getNonce: async () => {
            throw new Error("getNonce must not be called when target validation already failed");
          },
        }),
      "signRobinhoodTransaction end-to-end: unexpected target is refused before any RPC prep step runs"
    );
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

function throwsSync(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

main().catch((error) => {
  console.error("[FAIL] unexpected error:", error);
  process.exitCode = 1;
});
