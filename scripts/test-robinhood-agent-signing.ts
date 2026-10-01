/**
 * Deterministic tests for the PR09 Robinhood Chain autonomous agent
 * wallet/signing layer: lib/chain/robinhood-agent-wallet.ts,
 * lib/chain/robinhood-agent-signing.ts - including the hardening pass
 * that added full calldata semantic validation (not just target-address
 * allowlisting).
 *
 * No network calls, no broadcast. Key generation, encryption round-trip,
 * validation, and offline transaction signing are all real (not mocked)
 * - only the RPC-dependent prep steps (nonce/fee/gas) are injected via
 * signRobinhoodTransaction's `deps` parameter.
 *
 * Positive fixtures are REAL PR08 builder output
 * (buildNativeBuyTransaction/buildNativeSellTransaction/
 * buildErc20ApprovalTransaction/buildPermit2AuthorizationTransaction) -
 * never fake/random calldata dressed up as a "successful swap".
 *
 * NEVER prints a raw private key - only derived addresses and encrypted
 * blobs ever reach console.log/assertEqual output.
 *
 * Run: npm run test:robinhood-agent-signing
 */
import * as crypto from "node:crypto";
if (!process.env.AGENT_WALLET_ENCRYPTION_KEY?.trim()) {
  process.env.AGENT_WALLET_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
}

import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isHex,
  parseTransaction,
  type Address,
  type Hex,
} from "viem";

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
import { encryptSecret } from "@/lib/wallet/secret-encryption";
import {
  ACTION_SETTLE_ALL,
  ACTION_SWAP_EXACT_IN_SINGLE,
  ACTION_TAKE_ALL,
  COMMAND_V4_SWAP,
  EXACT_INPUT_SINGLE_ABI_TYPE,
  encodeV4SwapExactInSingle,
} from "@/lib/chain/robinhood-v4-actions";
import { computePoolId, NATIVE_CURRENCY, type PoolKey, type VerifiedPool } from "@/lib/chain/robinhood-v4-pool";
import type { QuoteSwapResult } from "@/lib/chain/robinhood-v4-quote";
import {
  buildErc20ApprovalTransaction,
  buildNativeBuyTransaction,
  buildNativeSellTransaction,
  buildPermit2AuthorizationTransaction,
  ERC20_ABI,
  PERMIT2_ABI,
  UNIVERSAL_ROUTER_EXECUTE_ABI,
  type UnsignedTransaction,
} from "@/lib/chain/robinhood-v4-swap-tx";

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

function throwsSync(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
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

// The exact pool the PR08 testnet swap audit (git history) verified - used
// only as a synthetic input here (no RPC), matching PR08's own test
// fixture in scripts/test-robinhood-v4-adapter.ts.
const AUDIT_FIXTURE_POOL_KEY: PoolKey = {
  currency0: NATIVE_CURRENCY,
  currency1: "0xf0EA05Cd5FD14189b80616eF36bE2caefd389D4E",
  fee: 20000,
  tickSpacing: 60,
  hooks: NATIVE_CURRENCY,
};
const FAKE_TOKEN: Address = AUDIT_FIXTURE_POOL_KEY.currency1;

function makeVerifiedPool(overrides: Partial<VerifiedPool> = {}): VerifiedPool {
  return {
    poolId: computePoolId(AUDIT_FIXTURE_POOL_KEY),
    poolKey: AUDIT_FIXTURE_POOL_KEY,
    liquidity: BigInt("86658770344474554895864"),
    sqrtPriceX96: BigInt("914231306612053323675460880563830"),
    tick: 187079,
    isHookless: true,
    ...overrides,
  };
}

function makeBuyQuote(overrides: Partial<Extract<QuoteSwapResult, { ok: true }>["quote"]> = {}) {
  return {
    pool: makeVerifiedPool(),
    side: "buy" as const,
    zeroForOne: true,
    amountIn: BigInt(100_000_000_000_000),
    amountOutQuoted: BigInt("13048885460744061051085"),
    amountOutMinimum: BigInt("12396441187706857998530"),
    quoterGasEstimate: BigInt(37565),
    currencyIn: NATIVE_CURRENCY,
    currencyOut: FAKE_TOKEN,
    network: "testnet" as const,
    chainId: 46630,
    ...overrides,
  };
}

function makeSellQuote(overrides: Partial<Extract<QuoteSwapResult, { ok: true }>["quote"]> = {}) {
  return {
    pool: makeVerifiedPool(),
    side: "sell" as const,
    zeroForOne: false,
    amountIn: BigInt("1000000000000000000"),
    amountOutQuoted: BigInt(7359919507),
    amountOutMinimum: BigInt(6991923531),
    quoterGasEstimate: BigInt(54310),
    currencyIn: FAKE_TOKEN,
    currencyOut: NATIVE_CURRENCY,
    network: "testnet" as const,
    chainId: 46630,
    ...overrides,
  };
}

/** Rebuilds a UniversalRouter.execute() calldata blob by hand, for
 * negative-test fixtures ONLY - never used to build a "successful"
 * fixture (those always come from the real PR08 builders above). */
function encodeExecute(commands: Hex, inputs: readonly Hex[], deadline: bigint): Hex {
  return encodeFunctionData({ abi: UNIVERSAL_ROUTER_EXECUTE_ABI, functionName: "execute", args: [commands, inputs, deadline] });
}

async function main() {
  // ═══ key generation (unchanged from prior pass) ═══════════════════════
  {
    const wallet = await generateRobinhoodAgentWallet();
    assert(/^0x[0-9a-fA-F]{40}$/.test(wallet.address), "generateRobinhoodAgentWallet produces a valid EVM address");
    assertEqual(wallet.chain, "robinhood", "generated wallet is tagged chain=robinhood");
    assertEqual(wallet.network, "testnet", "generated wallet is tagged with the active network (testnet)");
    // Not a substring check (base64 output can coincidentally contain
    // "0x") - asserts the actual shape a raw 32-byte hex private key
    // would have (0x + 64 hex chars) is absent.
    assert(!/^0x[0-9a-f]{64}$/i.test(wallet.secretEnc), "secretEnc is an encrypted blob, not a raw hex private key");
    const derived = robinhoodAgentAddressFromSecret(wallet.secretEnc);
    assertEqual(getAddress(derived), getAddress(wallet.address), "generated EVM key derives the correct, matching address");
  }

  // ═══ encrypt -> decrypt round trip / malformed / mismatch / missing ══
  {
    const wallet = await generateRobinhoodAgentWallet();
    const bot = makeBotRow({ agentPublicKey: wallet.address, agentSecretEnc: wallet.secretEnc });
    const loaded = await loadRobinhoodAgentAccount(bot);
    assertEqual(getAddress(loaded.address), getAddress(wallet.address), "loadRobinhoodAgentAccount: encrypt -> decrypt -> derive round trip matches");
  }
  {
    const walletA = await generateRobinhoodAgentWallet();
    const walletB = await generateRobinhoodAgentWallet();
    const bot = makeBotRow({ agentPublicKey: walletA.address, agentSecretEnc: walletB.secretEnc });
    await assertRejects(() => loadRobinhoodAgentAccount(bot), "loadRobinhoodAgentAccount refuses an address/key mismatch");
  }
  {
    const malformedSecretEnc = encryptSecret(new Uint8Array(16).fill(7));
    const bot = makeBotRow({ agentPublicKey: "0x1111111111111111111111111111111111111111", agentSecretEnc: malformedSecretEnc });
    await assertRejects(() => loadRobinhoodAgentAccount(bot), "loadRobinhoodAgentAccount refuses a malformed (non-32-byte) key");
  }
  {
    const bot = makeBotRow({ agentPublicKey: "0x1111111111111111111111111111111111111111", agentSecretEnc: null });
    await assertRejects(() => loadRobinhoodAgentAccount(bot), "loadRobinhoodAgentAccount refuses a missing key");
  }
  {
    const wallet = await generateRobinhoodAgentWallet();
    const bot = makeBotRow({ agentNetwork: "mainnet", agentPublicKey: wallet.address, agentSecretEnc: wallet.secretEnc });
    await assertRejects(() => loadRobinhoodAgentAccount(bot), "loadRobinhoodAgentAccount refuses a wrong network");
  }

  // ══════════════════════════════════════════════════════════════════════
  // FULL CALLDATA SEMANTIC VALIDATION - the hardening pass
  // ══════════════════════════════════════════════════════════════════════

  // ═══ 1-2. real PR08 native-buy builder is accepted end-to-end ════════
  {
    const quote = makeBuyQuote();
    const tx = buildNativeBuyTransaction(testnetConfig, quote);
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(!throwsSync(() => validateSignRobinhoodTransactionInput(input)), "real PR08 buildNativeBuyTransaction output passes full swap semantic validation");
  }

  // ═══ 3. real PR08 native-sell builder is accepted end-to-end ═════════
  {
    const quote = makeSellQuote();
    const tx = buildNativeSellTransaction(testnetConfig, quote);
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(!throwsSync(() => validateSignRobinhoodTransactionInput(input)), "real PR08 buildNativeSellTransaction output passes full swap semantic validation");
  }

  // ═══ 4. real PR08 ERC20 approval builder is accepted end-to-end ══════
  {
    const tx = buildErc20ApprovalTransaction(testnetConfig, FAKE_TOKEN, BigInt(1000));
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "erc20_approval", approvalToken: FAKE_TOKEN };
    assert(!throwsSync(() => validateSignRobinhoodTransactionInput(input)), "real PR08 buildErc20ApprovalTransaction output passes full erc20_approval semantic validation");
  }

  // ═══ 5. real PR08 Permit2 authorization builder is accepted end-to-end ═
  {
    const tx = buildPermit2AuthorizationTransaction(testnetConfig, FAKE_TOKEN, BigInt(5000));
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "permit2_authorization", approvalToken: FAKE_TOKEN };
    assert(!throwsSync(() => validateSignRobinhoodTransactionInput(input)), "real PR08 buildPermit2AuthorizationTransaction output passes full permit2_authorization semantic validation");
  }

  // ═══ SWAP negative fixtures ════════════════════════════════════════════
  const realBuyTx = buildNativeBuyTransaction(testnetConfig, makeBuyQuote());
  const realBuyDecoded = decodeFunctionData({ abi: UNIVERSAL_ROUTER_EXECUTE_ABI, data: realBuyTx.data }) as {
    functionName: string;
    args: readonly [Hex, readonly Hex[], bigint];
  };
  const [realCommands, realInputs, realDeadline] = realBuyDecoded.args;

  {
    // UniversalRouter + random calldata.
    const tx: UnsignedTransaction = { ...realBuyTx, data: "0xdeadbeef" as Hex };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "swap: UniversalRouter + random calldata is rejected");
  }
  {
    // Valid execute selector, but commands carries TWO bytes (an extra
    // command) instead of exactly one V4_SWAP byte.
    const twoCommandBytes = `0x${COMMAND_V4_SWAP.toString(16).padStart(2, "0")}${COMMAND_V4_SWAP.toString(16).padStart(2, "0")}` as Hex;
    const tx: UnsignedTransaction = { ...realBuyTx, data: encodeExecute(twoCommandBytes, realInputs, realDeadline) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "swap: valid execute selector + an additional command byte is rejected");
  }
  {
    // WRAP_ETH (0x0b) appended after V4_SWAP.
    const withWrap = `${realCommands}0b` as Hex;
    const tx: UnsignedTransaction = { ...realBuyTx, data: encodeExecute(withWrap, realInputs, realDeadline) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "swap: commands containing WRAP_ETH is rejected");
  }
  {
    // Wrong V4 action order: SETTLE_ALL before SWAP_EXACT_IN_SINGLE.
    const quote = makeBuyQuote();
    const exactInputSingleEncoded = encodeAbiParameters(
      [EXACT_INPUT_SINGLE_ABI_TYPE],
      [{ poolKey: quote.pool.poolKey, zeroForOne: quote.zeroForOne, amountIn: quote.amountIn, amountOutMinimum: quote.amountOutMinimum, hookData: "0x" }]
    );
    const settleEncoded = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [quote.currencyIn, quote.amountIn]);
    const takeEncoded = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [quote.currencyOut, quote.amountOutMinimum]);
    const reorderedActions = `0x${ACTION_SETTLE_ALL.toString(16).padStart(2, "0")}${ACTION_SWAP_EXACT_IN_SINGLE.toString(16).padStart(2, "0")}${ACTION_TAKE_ALL.toString(16).padStart(2, "0")}` as Hex;
    const v4SwapInput = encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      [reorderedActions, [settleEncoded, exactInputSingleEncoded, takeEncoded]]
    );
    const tx: UnsignedTransaction = { ...realBuyTx, data: encodeExecute(realCommands, [v4SwapInput], realDeadline) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "swap: wrong V4 action order is rejected");
  }
  {
    // Zero amountOutMinimum, bypassing PR08's builder-level check by
    // going straight to the lower-level encoder.
    const quote = makeBuyQuote();
    const { commands, inputs } = encodeV4SwapExactInSingle({
      exactInputSingle: { poolKey: quote.pool.poolKey, zeroForOne: quote.zeroForOne, amountIn: quote.amountIn, amountOutMinimum: BigInt(0), hookData: "0x" },
      settleCurrency: quote.currencyIn,
      settleMaxAmount: quote.amountIn,
      takeCurrency: quote.currencyOut,
      takeMinAmount: BigInt(0),
    });
    const tx: UnsignedTransaction = { ...realBuyTx, data: encodeExecute(commands, inputs, realDeadline) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "swap: zero amountOutMinimum is rejected at the signer layer too, independent of PR08's own builder check");
  }
  {
    // Inconsistent tx.value: real calldata, but value doesn't equal amountIn.
    const tx: UnsignedTransaction = { ...realBuyTx, value: realBuyTx.value + BigInt(1) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "swap: tx.value inconsistent with amountIn is rejected");
  }
  {
    // Expired deadline.
    const expiredDeadline = BigInt(Math.floor(Date.now() / 1000) - 100);
    const tx: UnsignedTransaction = { ...realBuyTx, data: encodeExecute(realCommands, realInputs, expiredDeadline) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "swap: expired deadline is rejected");
  }

  // ═══ canonical/trailing-bytes negative fixtures ═══════════════════════
  {
    // Real, valid native-buy calldata with one extra trailing byte
    // appended. decodeFunctionData does NOT throw on this (ABI decoding
    // isn't required to consume every trailing byte) - only the
    // canonical re-encode check catches it.
    const tx: UnsignedTransaction = { ...realBuyTx, data: `${realBuyTx.data}00` as Hex };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "swap: valid native buy calldata + trailing 00 byte is rejected");
  }
  {
    const sellTx = buildNativeSellTransaction(testnetConfig, makeSellQuote());
    const tx: UnsignedTransaction = { ...sellTx, data: `${sellTx.data}deadbeef` as Hex };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "swap: valid native sell calldata + trailing bytes is rejected");
  }
  {
    // Nested V4 input trailing bytes: the exactInputSingle payload inside
    // the V4_SWAP input carries extra bytes past what
    // EXACT_INPUT_SINGLE_ABI_TYPE actually needs - otherwise perfectly
    // decodable (decodeAbiParameters ignores the extra bytes), but the
    // canonical re-encode inside decodeV4SwapCommandsAndInputs must
    // reject it.
    const quote = makeBuyQuote();
    const exactInputSingleEncoded = encodeAbiParameters(
      [EXACT_INPUT_SINGLE_ABI_TYPE],
      [{ poolKey: quote.pool.poolKey, zeroForOne: quote.zeroForOne, amountIn: quote.amountIn, amountOutMinimum: quote.amountOutMinimum, hookData: "0x" }]
    );
    const exactInputSingleWithTrailingBytes = `${exactInputSingleEncoded}cafebabe` as Hex;
    const settleEncoded = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [quote.currencyIn, quote.amountIn]);
    const takeEncoded = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [quote.currencyOut, quote.amountOutMinimum]);
    const actions = `0x${ACTION_SWAP_EXACT_IN_SINGLE.toString(16).padStart(2, "0")}${ACTION_SETTLE_ALL.toString(16).padStart(2, "0")}${ACTION_TAKE_ALL.toString(16).padStart(2, "0")}` as Hex;
    const v4SwapInput = encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      [actions, [exactInputSingleWithTrailingBytes, settleEncoded, takeEncoded]]
    );
    const tx: UnsignedTransaction = { ...realBuyTx, data: encodeExecute(realCommands, [v4SwapInput], realDeadline) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "swap: otherwise-decodable trailing bytes inside the nested exactInputSingle payload is rejected");
  }

  // ═══ ERC20 approval negative fixtures ══════════════════════════════════
  const TRANSFER_ABI = [
    { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  ] as const;
  {
    const data = encodeFunctionData({ abi: TRANSFER_ABI, functionName: "transfer", args: ["0x2222222222222222222222222222222222222222", BigInt(1000)] });
    const tx: UnsignedTransaction = { chainId: testnetConfig.chainId, to: FAKE_TOKEN, data, value: BigInt(0) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "erc20_approval", approvalToken: FAKE_TOKEN };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "erc20_approval: correct token + transfer() is rejected");
  }
  {
    const wrongSpender: Address = "0x2222222222222222222222222222222222222222";
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [wrongSpender, BigInt(1000)] });
    const tx: UnsignedTransaction = { chainId: testnetConfig.chainId, to: FAKE_TOKEN, data, value: BigInt(0) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "erc20_approval", approvalToken: FAKE_TOKEN };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "erc20_approval: correct token + approve(wrong spender) is rejected");
  }
  {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [testnetConfig.permit2, BigInt(0)] });
    const tx: UnsignedTransaction = { chainId: testnetConfig.chainId, to: FAKE_TOKEN, data, value: BigInt(0) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "erc20_approval", approvalToken: FAKE_TOKEN };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "erc20_approval: correct token + approve(Permit2, 0) is rejected");
  }
  {
    const realApprovalTx = buildErc20ApprovalTransaction(testnetConfig, FAKE_TOKEN, BigInt(1000));
    const tx: UnsignedTransaction = { ...realApprovalTx, data: `${realApprovalTx.data}00` as Hex };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "erc20_approval", approvalToken: FAKE_TOKEN };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "erc20_approval: valid approve() + trailing bytes is rejected");
  }

  // ═══ Permit2 authorization negative fixtures ═══════════════════════════
  {
    // Arbitrary selector: a 2-arg approve() (ERC20 shape) sent to Permit2,
    // which only recognizes the 4-arg approve().
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [testnetConfig.universalRouter, BigInt(1000)] });
    const tx: UnsignedTransaction = { chainId: testnetConfig.chainId, to: testnetConfig.permit2, data, value: BigInt(0) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "permit2_authorization", approvalToken: FAKE_TOKEN };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "permit2_authorization: an arbitrary/wrong-shaped selector is rejected");
  }
  {
    const wrongSpender: Address = "0x2222222222222222222222222222222222222222";
    const expiration = Math.floor(Date.now() / 1000) + 1200;
    const data = encodeFunctionData({ abi: PERMIT2_ABI, functionName: "approve", args: [FAKE_TOKEN, wrongSpender, BigInt(1000), expiration] });
    const tx: UnsignedTransaction = { chainId: testnetConfig.chainId, to: testnetConfig.permit2, data, value: BigInt(0) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "permit2_authorization", approvalToken: FAKE_TOKEN };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "permit2_authorization: wrong spender (not UniversalRouter) is rejected");
  }
  {
    // Real builder output, but the caller's EXPECTED token doesn't match
    // what was actually encoded.
    const tx = buildPermit2AuthorizationTransaction(testnetConfig, FAKE_TOKEN, BigInt(1000));
    const differentToken: Address = "0x2222222222222222222222222222222222222222";
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "permit2_authorization", approvalToken: differentToken };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "permit2_authorization: wrong (mismatched) expected token is rejected");
  }
  {
    const expiredExpiration = Math.floor(Date.now() / 1000) - 100;
    const data = encodeFunctionData({ abi: PERMIT2_ABI, functionName: "approve", args: [FAKE_TOKEN, testnetConfig.universalRouter, BigInt(1000), expiredExpiration] });
    const tx: UnsignedTransaction = { chainId: testnetConfig.chainId, to: testnetConfig.permit2, data, value: BigInt(0) };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "permit2_authorization", approvalToken: FAKE_TOKEN };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "permit2_authorization: expired authorization is rejected");
  }
  {
    const realPermit2Tx = buildPermit2AuthorizationTransaction(testnetConfig, FAKE_TOKEN, BigInt(1000));
    const tx: UnsignedTransaction = { ...realPermit2Tx, data: `${realPermit2Tx.data}00` as Hex };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: tx, intent: "permit2_authorization", approvalToken: FAKE_TOKEN };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "permit2_authorization: valid approve() + trailing bytes is rejected");
  }

  // ═══ basic field/network guards (unchanged behavior, still covered) ══
  {
    const wrongChainIdTx: UnsignedTransaction = { ...realBuyTx, chainId: 999999 };
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow(), unsignedTransaction: wrongChainIdTx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "wrong chainId is refused");
  }
  {
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow({ agentNetwork: "mainnet" }), unsignedTransaction: realBuyTx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "mainnet signing fails closed");
  }
  {
    const input: SignRobinhoodTransactionInput = { bot: makeBotRow({ agentNetwork: null }), unsignedTransaction: realBuyTx, intent: "swap" };
    assert(throwsSync(() => validateSignRobinhoodTransactionInput(input)), "a bot with no recorded agentNetwork fails closed");
  }

  // ═══ full offline sign: real PR08 output, real key, injected RPC prep ═
  {
    const wallet = await generateRobinhoodAgentWallet();
    const bot = makeBotRow({ agentPublicKey: wallet.address, agentSecretEnc: wallet.secretEnc });
    const input: SignRobinhoodTransactionInput = { bot, unsignedTransaction: realBuyTx, intent: "swap" };

    const signed = await signRobinhoodTransaction(input, {
      assertNetwork: async () => {},
      getNonce: async () => 7,
      estimateFeesPerGas: async () => ({ maxFeePerGas: BigInt(2_000_000_000), maxPriorityFeePerGas: BigInt(1_000_000_000) }),
      estimateGas: async () => BigInt(150_000),
    });

    assertEqual(signed.chainId, testnetConfig.chainId, "signed tx carries the expected chainId");
    assertEqual(getAddress(signed.to), getAddress(testnetConfig.universalRouter), "signed tx carries the expected to");
    assertEqual(signed.value, realBuyTx.value, "signed tx carries the expected value");
    assertEqual(signed.nonce, 7, "signed tx carries the injected nonce");
    assert(isHex(signed.signedRawTransaction), "signedRawTransaction is hex");
    assert(
      !JSON.stringify(signed, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).toLowerCase().includes("privatekey"),
      "signing result never includes a field named privateKey"
    );

    const decoded = parseTransaction(signed.signedRawTransaction);
    assertEqual(decoded.chainId, testnetConfig.chainId, "decoded signed tx: chainId matches");
    assertEqual(getAddress(decoded.to as Address), getAddress(testnetConfig.universalRouter), "decoded signed tx: to matches");
    assertEqual(decoded.value, realBuyTx.value, "decoded signed tx: value matches");
    assertEqual(decoded.data, realBuyTx.data, "decoded signed tx: data matches");
    assertEqual(decoded.nonce, 7, "decoded signed tx: nonce matches");
    assert(decoded.type === "eip1559", "decoded signed tx: type is eip1559");
  }
  {
    // The full signRobinhoodTransaction path also rejects bad calldata
    // before ever touching the key/RPC deps.
    const wallet = await generateRobinhoodAgentWallet();
    const bot = makeBotRow({ agentPublicKey: wallet.address, agentSecretEnc: wallet.secretEnc });
    const badTx: UnsignedTransaction = { ...realBuyTx, data: "0xdeadbeef" as Hex };
    const input: SignRobinhoodTransactionInput = { bot, unsignedTransaction: badTx, intent: "swap" };
    await assertRejects(
      () =>
        signRobinhoodTransaction(input, {
          assertNetwork: async () => {},
          getNonce: async () => {
            throw new Error("getNonce must not be called when calldata semantic validation already failed");
          },
        }),
      "signRobinhoodTransaction end-to-end: bad calldata is refused before any RPC prep step runs"
    );
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("[FAIL] unexpected error:", error);
  process.exitCode = 1;
});
