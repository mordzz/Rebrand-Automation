/**
 * Robinhood agent signing, wallet view, broadcaster, Uniswap v4 adapter and alpha feed (offline).
 *
 * Consolidated from: test-robinhood-agent-signing.ts, test-robinhood-agent-wallet-view.ts, test-robinhood-broadcast.ts, test-robinhood-v4-adapter.ts, test-robinhood-alpha.ts.
 * Each original suite runs in its own function scope.
 */
import * as crypto from "node:crypto";
if (!process.env.AGENT_WALLET_ENCRYPTION_KEY?.trim()) {
  process.env.AGENT_WALLET_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
}

import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, isHex, parseTransaction, type Address, type Hex, keccak256, type TransactionReceipt, isAddress } from "viem";
import { generateRobinhoodAgentWallet, loadRobinhoodAgentAccount, robinhoodAgentAddressFromSecret, type AgentWalletBotRow } from "@/lib/chain/robinhood-agent-wallet";
import { signRobinhoodTransaction, validateSignRobinhoodTransactionInput, type SignRobinhoodTransactionInput, type SignedRobinhoodTransaction } from "@/lib/chain/robinhood-agent-signing";
import { resolveRobinhoodExecutionConfig, type RobinhoodExecutionConfig } from "@/lib/chain/robinhood-execution-config";
import { encryptSecret } from "@/lib/wallet/secret-encryption";
import { ACTION_SETTLE_ALL, ACTION_SWAP_EXACT_IN_SINGLE, ACTION_TAKE_ALL, COMMAND_V4_SWAP, EXACT_INPUT_SINGLE_ABI_TYPE, encodeV4SwapExactInSingle, assertNoWrapCommands } from "@/lib/chain/robinhood-v4-actions";
import { computePoolId, NATIVE_CURRENCY, type PoolKey, type VerifiedPool, validatePoolKey } from "@/lib/chain/robinhood-v4-pool";
import { type QuoteSwapResult, quoteSwap } from "@/lib/chain/robinhood-v4-quote";
import { buildErc20ApprovalTransaction, buildNativeBuyTransaction, buildNativeSellTransaction, buildPermit2AuthorizationTransaction, ERC20_ABI, PERMIT2_ABI, UNIVERSAL_ROUTER_EXECUTE_ABI, type UnsignedTransaction } from "@/lib/chain/robinhood-v4-swap-tx";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRobinhoodAgentWalletView, loadRobinhoodAgentAccountView } from "@/lib/chain/robinhood-agent-wallet-view";
import { ROBINHOOD_NATIVE_SYMBOL, ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { BROADCAST_CHAIN_ID, broadcastRobinhoodTransaction, verifySignedTransaction, waitForRobinhoodReceipt, type BroadcastDeps, type BroadcastRecord } from "@/lib/chain/robinhood-broadcast";
import { computeAmountOutMinimum, MAX_SLIPPAGE_BPS } from "@/lib/chain/robinhood-v4-slippage";
import { interpretMinedReceipt, interpretSwapReceipt } from "@/lib/chain/robinhood-v4-receipt";
import { RobinhoodRpcError } from "@/lib/chain/rpc";
import { __resetRobinhoodAlphaForTests, getRobinhoodAlpha, type RobinhoodAlphaDeps } from "@/lib/alpha/robinhood-alpha";
import type { RobinhoodDiscoveredToken } from "@/lib/gmgn/discovery-robinhood";
import type { RobinhoodSafetyCheckResult } from "@/lib/gmgn/safety-robinhood";
import type { SniperConfig } from "@/lib/sniper/config";

async function robinhood_agent_signing(): Promise<void> {
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
  // fixture in tests/robinhood.ts.
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
    if (failures !== 0) process.exitCode = 1;
  }


  await main();
}

async function robinhood_agent_wallet_view(): Promise<void> {
  let failures = 0;

  function assertEqual(actual: unknown, expected: unknown, label: string): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
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

  const AGENT_ADDRESS = "0x1111111111111111111111111111111111111111";

  async function main() {
    // ═══ Robinhood balance path used, correct fields ══════════════════════
    {
      const view = buildRobinhoodAgentWalletView(
        { agentPublicKey: AGENT_ADDRESS, agentNetwork: ROBINHOOD_NETWORK },
        { balanceWei: BigInt("1500000000000000000"), error: null } // 1.5 ETH
      );
      assert(!("reason" in view), "matching network produces a real wallet view, not a network_mismatch");
      if (!("reason" in view)) {
        assertEqual(view.chain, "robinhood", "view.chain === 'robinhood'");
        assertEqual(view.network, ROBINHOOD_NETWORK, "view.network matches the active Robinhood network");
        assertEqual(view.nativeSymbol, ROBINHOOD_NATIVE_SYMBOL, "view.nativeSymbol === ETH");
        assertEqual(view.address, AGENT_ADDRESS, "view.address matches the agent's public key");
        assertEqual(view.balanceNative, "1.5", "1.5 ETH in wei formats to the decimal string '1.5'");
        assertEqual(view.sizeNative, null, "sizeNative is null - no invented required-funding number");
        assertEqual(view.requiredNative, null, "requiredNative is null - no invented required-funding number");
        assertEqual(view.sufficient, null, "sufficient is null - no invented sufficiency threshold");
        assertEqual(view.error, null, "error is null when balance read succeeded");
      }
    }
    {
      // Balance read failed - error surfaces, balanceNative stays null
      // (never reported as 0, which would look like a drained wallet).
      const view = buildRobinhoodAgentWalletView(
        { agentPublicKey: AGENT_ADDRESS, agentNetwork: ROBINHOOD_NETWORK },
        { balanceWei: null, error: "RPC unavailable" }
      );
      assert(!("reason" in view), "a balance-read failure still produces a wallet view, not a network_mismatch");
      if (!("reason" in view)) {
        assertEqual(view.balanceNative, null, "balanceNative is null when the read failed, never reported as 0");
        assertEqual(view.error, "RPC unavailable", "the read error is surfaced");
      }
    }

    // ═══ no ETH values leak into Solana-named fields ══════════════════════
    {
      const view = buildRobinhoodAgentWalletView(
        { agentPublicKey: AGENT_ADDRESS, agentNetwork: ROBINHOOD_NETWORK },
        { balanceWei: BigInt(1_000_000_000_000_000_000), error: null }
      );
      const keys = Object.keys(view);
      assert(!keys.includes("balanceSol"), "Robinhood view never includes balanceSol");
      assert(!keys.includes("sizeSol"), "Robinhood view never includes sizeSol");
      assert(!keys.includes("requiredSol"), "Robinhood view never includes requiredSol");
    }

    // ═══ network mismatch fails closed rather than reading the wrong network ═
    {
      const view = buildRobinhoodAgentWalletView(
        { agentPublicKey: AGENT_ADDRESS, agentNetwork: "mainnet" }, // active network is testnet in this env
        { balanceWei: BigInt(1), error: null }
      );
      assert("reason" in view && view.reason === "network_mismatch", "a bot recorded for a different network than the active one returns network_mismatch, never a balance");
    }
    {
      const view = buildRobinhoodAgentWalletView(
        { agentPublicKey: AGENT_ADDRESS, agentNetwork: null },
        { balanceWei: BigInt(1), error: null }
      );
      assert("reason" in view && view.reason === "network_mismatch", "a bot with no recorded agentNetwork also fails closed as network_mismatch, never assumed");
    }

    // ═══ loadRobinhoodAgentAccountView: network mismatch BEFORE any RPC read ═
    {
      let calls = 0;
      const view = await loadRobinhoodAgentAccountView(
        { agentPublicKey: AGENT_ADDRESS, agentNetwork: "mainnet" }, // active network is testnet in this env
        {
          getBalance: async () => {
            calls++;
            return BigInt(1);
          },
        }
      );
      assertEqual(calls, 0, "network mismatch: the balance dependency is called exactly 0 times");
      assert("reason" in view && view.reason === "network_mismatch", "network mismatch: loader returns network_mismatch");
    }
    {
      let calls = 0;
      const view = await loadRobinhoodAgentAccountView(
        { agentPublicKey: AGENT_ADDRESS, agentNetwork: null },
        {
          getBalance: async () => {
            calls++;
            return BigInt(1);
          },
        }
      );
      assertEqual(calls, 0, "no recorded agentNetwork: the balance dependency is called exactly 0 times");
      assert("reason" in view && view.reason === "network_mismatch", "no recorded agentNetwork: loader returns network_mismatch");
    }
    {
      let calls = 0;
      const view = await loadRobinhoodAgentAccountView(
        { agentPublicKey: AGENT_ADDRESS, agentNetwork: ROBINHOOD_NETWORK },
        {
          getBalance: async () => {
            calls++;
            return BigInt("2000000000000000000"); // 2 ETH
          },
        }
      );
      assertEqual(calls, 1, "matching network: the balance dependency is called exactly 1 time");
      assert(!("reason" in view), "matching network: loader returns a real wallet view");
      if (!("reason" in view)) {
        assertEqual(view.balanceNative, "2", "matching network: loader's view reflects the dependency's returned balance");
      }
    }
    {
      // The dependency throwing must not throw out of the loader - it
      // surfaces as a wallet-view error, same as buildRobinhoodAgentWalletView's
      // own failed-read handling.
      let calls = 0;
      const view = await loadRobinhoodAgentAccountView(
        { agentPublicKey: AGENT_ADDRESS, agentNetwork: ROBINHOOD_NETWORK },
        {
          getBalance: async () => {
            calls++;
            throw new Error("simulated RPC failure");
          },
        }
      );
      assertEqual(calls, 1, "matching network + failed read: the balance dependency is still called exactly once");
      assert(!("reason" in view), "matching network + failed read: loader still returns a real wallet view, not network_mismatch");
      if (!("reason" in view)) {
        assertEqual(view.balanceNative, null, "matching network + failed read: balanceNative is null, not 0");
        assertEqual(view.error, "simulated RPC failure", "matching network + failed read: the dependency's error message is surfaced");
      }
    }

    // ═══ structural: the Robinhood view module never references the Solana
    // balance reader at all - not just "the route doesn't call it today" ═
    {
      const source = readFileSync(
        join(process.cwd(), "lib", "chain", "robinhood-agent-wallet-view.ts"),
        "utf8"
      );
      assert(!/from ["']@\/lib\/solana/i.test(source), "lib/chain/robinhood-agent-wallet-view.ts imports nothing from lib/solana/* (doc-comment mentions of \"Solana\" for context are fine)");
      assert(!source.includes("getAddressBalance"), "lib/chain/robinhood-agent-wallet-view.ts never imports/calls getAddressBalance (the Solana balance reader)");
    }

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    if (failures !== 0) process.exitCode = 1;
  }


  await main();
}

async function robinhood_broadcast(): Promise<void> {
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
    if (failures !== 0) process.exitCode = 1;
  }


  await main();
}

async function robinhood_v4_adapter(): Promise<void> {
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

  function assertThrows(fn: () => void, label: string): void {
    try {
      fn();
      console.error(`[FAIL] ${label} (did not throw)`);
      failures++;
    } catch {
      console.log(`[PASS] ${label}`);
    }
  }

  // Fixture pool, per the PR08 testnet swap audit (git history) - used only as
  // a synthetic input here (no RPC), never treated as a production token.
  const AUDIT_FIXTURE_POOL_KEY: PoolKey = {
    currency0: NATIVE_CURRENCY,
    currency1: "0xf0EA05Cd5FD14189b80616eF36bE2caefd389D4E",
    fee: 20000,
    tickSpacing: 60,
    hooks: NATIVE_CURRENCY,
  };

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
      amountOutMinimum: BigInt("12396441187706857998531"),
      quoterGasEstimate: BigInt(37565),
      currencyIn: NATIVE_CURRENCY,
      currencyOut: AUDIT_FIXTURE_POOL_KEY.currency1,
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
      currencyIn: AUDIT_FIXTURE_POOL_KEY.currency1,
      currencyOut: NATIVE_CURRENCY,
      network: "testnet" as const,
      chainId: 46630,
      ...overrides,
    };
  }

  async function main() {
    // ═══ execution config: fail-closed for mainnet, testnet has real addresses ═
    {
      const result = resolveRobinhoodExecutionConfig("testnet");
      assertEqual(result.ok, true, "resolveRobinhoodExecutionConfig(testnet) succeeds");
      if (result.ok) {
        assertEqual(result.config.chainId, 46630, "testnet config chainId matches audit");
        assertEqual(result.config.mode, "native_v4", "testnet config mode is native_v4");
        for (const [key, value] of Object.entries(result.config)) {
          if (key === "network" || key === "chainId" || key === "mode") continue;
          assert(isAddress(value as string), `testnet config.${key} is a valid EVM address`);
        }
      }
    }
    {
      const result = resolveRobinhoodExecutionConfig("mainnet");
      assertEqual(result.ok, false, "resolveRobinhoodExecutionConfig(mainnet) fails closed");
    }
    {
      // Cross-network address confusion is impossible by construction: the
      // resolver has exactly one populated config object (testnet's), and
      // mainnet never falls back to it.
      const testnetResult = resolveRobinhoodExecutionConfig("testnet");
      const mainnetResult = resolveRobinhoodExecutionConfig("mainnet");
      assert(
        testnetResult.ok && !mainnetResult.ok,
        "testnet resolves with real addresses while mainnet fails closed, never the reverse"
      );
    }

    const testnetConfig: RobinhoodExecutionConfig = (() => {
      const result = resolveRobinhoodExecutionConfig("testnet");
      if (!result.ok) throw new Error("testnet config must resolve for this test file's fixtures");
      return result.config;
    })();

    // ═══ slippage → minimum output ═══════════════════════════════════════
    {
      const result = computeAmountOutMinimum(BigInt("13048885460744061051085"), 500);
      assertEqual(result.ok, true, "5% slippage on the audit's quoted amount succeeds");
      if (result.ok) {
        assertEqual(
          result.amountOutMinimum,
          BigInt("12396441187706857998530"),
          "5% slippage computes the expected integer minimum (bigint floor division)"
        );
      }
    }
    {
      const result = computeAmountOutMinimum(BigInt(1000), 0);
      assertEqual(result.ok, true, "0 bps slippage succeeds");
      if (result.ok) assertEqual(result.amountOutMinimum, BigInt(1000), "0 bps slippage → minimum equals quoted amount exactly");
    }
    {
      const result = computeAmountOutMinimum(BigInt(1000), MAX_SLIPPAGE_BPS);
      assertEqual(result, { ok: false, reason: `slippageBps must satisfy 0 <= slippageBps < ${MAX_SLIPPAGE_BPS}, got ${MAX_SLIPPAGE_BPS}` }, "100% slippage (== MAX_SLIPPAGE_BPS) is refused, not accepted as a valid edge case");
    }
    {
      const result = computeAmountOutMinimum(BigInt(1000), -1);
      assertEqual(result.ok, false, "negative slippageBps refused");
    }
    {
      const result = computeAmountOutMinimum(BigInt(1000), 1.5);
      assertEqual(result.ok, false, "non-integer slippageBps refused");
    }
    {
      const result = computeAmountOutMinimum(BigInt(-1), 100);
      assertEqual(result.ok, false, "negative amountOutQuoted refused");
    }
    {
      // A tiny quote at high slippage rounds to zero - must refuse rather
      // than allow an unbounded-downside fill.
      const result = computeAmountOutMinimum(BigInt(1), 9999);
      assertEqual(result.ok, false, "amountOutMinimum rounding to 0 from a non-zero quote is refused");
    }
    {
      const result = computeAmountOutMinimum(BigInt(0), 500);
      assertEqual(result, { ok: true, amountOutMinimum: BigInt(0) }, "a zero quote legitimately produces a zero minimum (not the same failure as a rounded-to-zero non-zero quote)");
    }

    // ═══ v4 action encoding: no WRAP_ETH/UNWRAP_WETH ever, on any input ═══
    {
      const { commands } = encodeV4SwapExactInSingle({
        exactInputSingle: {
          poolKey: AUDIT_FIXTURE_POOL_KEY,
          zeroForOne: true,
          amountIn: BigInt(100),
          amountOutMinimum: BigInt(1),
          hookData: "0x",
        },
        settleCurrency: NATIVE_CURRENCY,
        settleMaxAmount: BigInt(100),
        takeCurrency: AUDIT_FIXTURE_POOL_KEY.currency1,
        takeMinAmount: BigInt(1),
      });
      assertEqual(commands, "0x10", "encoded commands is exactly V4_SWAP (0x10), nothing else");
      let threw = false;
      try {
        assertNoWrapCommands(commands);
      } catch {
        threw = true;
      }
      assert(!threw, "assertNoWrapCommands passes on a real V4_SWAP-only commands byte string");
    }
    {
      assertThrows(() => assertNoWrapCommands("0x0b"), "assertNoWrapCommands throws on a bare WRAP_ETH command byte");
      assertThrows(() => assertNoWrapCommands("0x0c"), "assertNoWrapCommands throws on a bare UNWRAP_WETH command byte");
      assertThrows(
        () => assertNoWrapCommands("0x100b10"),
        "assertNoWrapCommands throws when WRAP_ETH is buried among other command bytes"
      );
    }
    {
      // The one coincidence explicitly documented in robinhood-v4-actions.ts:
      // ACTION_SETTLE_ALL happens to equal the UNWRAP_WETH command byte
      // (0x0c), but assertNoWrapCommands only ever receives top-level
      // `commands`, never nested `actions` bytes - so a real encoded V4_SWAP
      // (whose nested actions DO contain 0x0c as SETTLE_ALL) must never trip
      // the guard, because that 0x0c never appears in `commands` itself.
      const { commands } = encodeV4SwapExactInSingle({
        exactInputSingle: {
          poolKey: AUDIT_FIXTURE_POOL_KEY,
          zeroForOne: false,
          amountIn: BigInt(1),
          amountOutMinimum: BigInt(1),
          hookData: "0x",
        },
        settleCurrency: AUDIT_FIXTURE_POOL_KEY.currency1,
        settleMaxAmount: BigInt(1),
        takeCurrency: NATIVE_CURRENCY,
        takeMinAmount: BigInt(1),
      });
      assertEqual(
        commands,
        "0x10",
        "commands byte string for the reverse (sell) direction is also exactly V4_SWAP (0x10) - SETTLE_ALL's 0x0c value lives only in the nested actions bytes, never in commands"
      );
    }

    // ═══ computePoolId is deterministic and matches the audit's pool ID ═══
    {
      const poolId = computePoolId(AUDIT_FIXTURE_POOL_KEY);
      assertEqual(
        poolId,
        computePoolId({ ...AUDIT_FIXTURE_POOL_KEY }),
        "computePoolId is deterministic for identical PoolKeys"
      );
      const differentFee = computePoolId({ ...AUDIT_FIXTURE_POOL_KEY, fee: 3000 });
      assert(poolId !== differentFee, "computePoolId changes when any PoolKey field changes");
    }

    // ═══ unsigned native-ETH buy transaction builder ═════════════════════
    {
      const quote = makeBuyQuote();
      const tx = buildNativeBuyTransaction(testnetConfig, quote);
      assertEqual(tx.to, testnetConfig.universalRouter, "buy tx targets UniversalRouter");
      assertEqual(tx.chainId, testnetConfig.chainId, "buy tx carries testnet chainId");
      assertEqual(tx.value, quote.amountIn, "buy tx msg.value === amountIn exactly");
      assert(tx.amountOutMinimum > BigInt(0), "buy tx carries a non-zero amountOutMinimum");
      assert(tx.deadline > BigInt(Math.floor(Date.now() / 1000)), "buy tx deadline is in the future");
    }
    {
      const quote = makeBuyQuote({ amountOutMinimum: BigInt(0) });
      assertThrows(
        () => buildNativeBuyTransaction(testnetConfig, quote),
        "buildNativeBuyTransaction refuses a zero amountOutMinimum"
      );
    }
    {
      const quote = makeSellQuote();
      assertThrows(
        () => buildNativeBuyTransaction(testnetConfig, quote as unknown as ReturnType<typeof makeBuyQuote>),
        "buildNativeBuyTransaction refuses a quote whose side is not buy"
      );
    }

    // ═══ unsigned token-sell transaction builder ═════════════════════════
    {
      const quote = makeSellQuote();
      const tx = buildNativeSellTransaction(testnetConfig, quote);
      assertEqual(tx.to, testnetConfig.universalRouter, "sell tx targets UniversalRouter");
      assertEqual(tx.value, BigInt(0), "sell tx attaches no native ETH (value === 0n)");
      assert(tx.amountOutMinimum > BigInt(0), "sell tx carries a non-zero amountOutMinimum");
    }
    {
      const quote = makeSellQuote({ amountOutMinimum: BigInt(0) });
      assertThrows(
        () => buildNativeSellTransaction(testnetConfig, quote),
        "buildNativeSellTransaction refuses a zero amountOutMinimum"
      );
    }
    {
      const quote = makeBuyQuote();
      assertThrows(
        () => buildNativeSellTransaction(testnetConfig, quote as unknown as ReturnType<typeof makeSellQuote>),
        "buildNativeSellTransaction refuses a quote whose side is not sell"
      );
    }

    // ═══ deadline handling ════════════════════════════════════════════════
    {
      const quote = makeBuyQuote();
      const nowSec = Math.floor(Date.now() / 1000);
      const txDefault = buildNativeBuyTransaction(testnetConfig, quote);
      assert(
        txDefault.deadline >= BigInt(nowSec + 1199) && txDefault.deadline <= BigInt(nowSec + 1201),
        "default deadline is ~1200s (20min) from now"
      );
      const txCustom = buildNativeBuyTransaction(testnetConfig, quote, { deadlineSeconds: 60 });
      assert(
        txCustom.deadline >= BigInt(nowSec + 59) && txCustom.deadline <= BigInt(nowSec + 61),
        "custom deadlineSeconds is honored"
      );
    }

    // ═══ approval / Permit2 builders: exact-amount only, never unlimited ═
    {
      const tx = buildErc20ApprovalTransaction(testnetConfig, AUDIT_FIXTURE_POOL_KEY.currency1, BigInt(1000));
      assertEqual(tx.to, AUDIT_FIXTURE_POOL_KEY.currency1, "ERC-20 approval targets the token contract, not the router/Permit2");
      assertEqual(tx.value, BigInt(0), "ERC-20 approval carries no native ETH");
      assert(
        !tx.data.toLowerCase().includes("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
        "ERC-20 approval calldata does not contain a type(uint256).max unlimited-approval pattern"
      );
    }
    assertThrows(
      () => buildErc20ApprovalTransaction(testnetConfig, AUDIT_FIXTURE_POOL_KEY.currency1, BigInt(0)),
      "buildErc20ApprovalTransaction refuses a zero amount"
    );
    assertThrows(
      () => buildErc20ApprovalTransaction(testnetConfig, AUDIT_FIXTURE_POOL_KEY.currency1, BigInt(-1)),
      "buildErc20ApprovalTransaction refuses a negative amount"
    );
    {
      const tx = buildPermit2AuthorizationTransaction(testnetConfig, AUDIT_FIXTURE_POOL_KEY.currency1, BigInt(1000));
      assertEqual(tx.to, testnetConfig.permit2, "Permit2 authorization targets the Permit2 contract");
      assertEqual(tx.value, BigInt(0), "Permit2 authorization carries no native ETH");
    }
    assertThrows(
      () => buildPermit2AuthorizationTransaction(testnetConfig, AUDIT_FIXTURE_POOL_KEY.currency1, BigInt(0)),
      "buildPermit2AuthorizationTransaction refuses a zero amount"
    );
    {
      const uint160Max = BigInt("0xffffffffffffffffffffffffffffffffffffff");
      assertThrows(
        () => buildPermit2AuthorizationTransaction(testnetConfig, AUDIT_FIXTURE_POOL_KEY.currency1, uint160Max + BigInt(1)),
        "buildPermit2AuthorizationTransaction refuses an amount exceeding uint160 range"
      );
      const tx = buildPermit2AuthorizationTransaction(testnetConfig, AUDIT_FIXTURE_POOL_KEY.currency1, uint160Max);
      assert(!!tx, "buildPermit2AuthorizationTransaction accepts an amount exactly at the uint160 boundary");
    }
    {
      const nowSec = Math.floor(Date.now() / 1000);
      const tx = buildPermit2AuthorizationTransaction(testnetConfig, AUDIT_FIXTURE_POOL_KEY.currency1, BigInt(1000), { expirationSeconds: 300 });
      // expiration is encoded in calldata, not exposed on the returned
      // UnsignedTransaction shape - proving it's bounded requires only that
      // the call didn't throw and that it differs from the default-expiry
      // encoding, which the two constructed txs below confirm.
      const txDefault = buildPermit2AuthorizationTransaction(testnetConfig, AUDIT_FIXTURE_POOL_KEY.currency1, BigInt(1000));
      assert(tx.data !== txDefault.data, "a custom expirationSeconds produces different calldata than the default expiry");
      assert(nowSec > 0, "sanity: clock is available for expiry bound checks");
    }

    // ═══ receipt interpretation ═══════════════════════════════════════════
    function makeReceipt(overrides: Partial<TransactionReceipt> = {}): TransactionReceipt {
      return {
        status: "success",
        to: testnetConfig.universalRouter,
        from: "0x1111111111111111111111111111111111111111",
        transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        blockHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        blockNumber: BigInt(1),
        contractAddress: null,
        cumulativeGasUsed: BigInt(1),
        effectiveGasPrice: BigInt(1),
        gasUsed: BigInt(1),
        logs: [],
        logsBloom: "0x00",
        transactionIndex: 0,
        type: "eip1559",
        ...overrides,
      } as TransactionReceipt;
    }

    // ═══ interpretMinedReceipt: pure, no network - the core router-target guard ═
    {
      const result = interpretMinedReceipt(testnetConfig, makeReceipt());
      assertEqual(result.status, "success", "successful receipt to the configured router → success");
    }
    {
      const result = interpretMinedReceipt(testnetConfig, makeReceipt({ status: "reverted" }));
      assertEqual(result.status, "reverted", "reverted receipt → reverted, regardless of target");
    }
    {
      // The exact scenario this hardening pass exists for: a successful
      // receipt, but sent somewhere other than the configured router. Must
      // NEVER be reported as a successful swap.
      const result = interpretMinedReceipt(
        testnetConfig,
        makeReceipt({ to: "0x2222222222222222222222222222222222222222" })
      );
      assertEqual(result.status, "unexpected_target", "successful receipt to an unrelated address → unexpected_target, never success");
      if (result.status === "unexpected_target") {
        assertEqual(result.actualTarget, "0x2222222222222222222222222222222222222222", "unexpected_target carries the actual (wrong) target address");
      }
    }
    {
      const result = interpretMinedReceipt(testnetConfig, makeReceipt({ to: null }));
      assertEqual(result.status, "unexpected_target", "a null receipt.to (contract creation) is never treated as success");
    }
    {
      // EVM-address-safe comparison: differing only in casing must still
      // match, proving this isn't a raw case-sensitive string compare.
      const result = interpretMinedReceipt(
        testnetConfig,
        makeReceipt({ to: testnetConfig.universalRouter.toLowerCase() as `0x${string}` })
      );
      assertEqual(result.status, "success", "receipt.to matching the router in a different case is still recognized as the router");
    }

    // ═══ interpretSwapReceipt: pending / not_found / rpc_unavailable via injected fetchStatus ═
    {
      const result = await interpretSwapReceipt(testnetConfig, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
        fetchStatus: async () => ({ status: "pending" }),
        assertNetwork: async () => {},
      });
      assertEqual(result, { status: "pending" }, "interpretSwapReceipt: pending status passes through");
    }
    {
      const result = await interpretSwapReceipt(testnetConfig, "not-a-real-hash", {
        fetchStatus: async () => {
          throw new RobinhoodRpcError("invalid_hash", "not a valid hash");
        },
        assertNetwork: async () => {},
      });
      assertEqual(result, { status: "not_found" }, "interpretSwapReceipt: invalid_hash maps to not_found");
    }
    {
      const result = await interpretSwapReceipt(testnetConfig, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
        fetchStatus: async () => {
          throw new RobinhoodRpcError("not_found", "no such transaction");
        },
        assertNetwork: async () => {},
      });
      assertEqual(result, { status: "not_found" }, "interpretSwapReceipt: not_found error maps to not_found");
    }
    {
      const result = await interpretSwapReceipt(testnetConfig, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
        fetchStatus: async () => {
          throw new RobinhoodRpcError("rpc_unavailable", "connection refused");
        },
        assertNetwork: async () => {},
      });
      assertEqual(result.status, "rpc_unavailable", "interpretSwapReceipt: rpc_unavailable error maps to rpc_unavailable");
    }
    {
      // The network/execution-config guard runs before any transaction
      // lookup - a mismatched config must fail closed as rpc_unavailable,
      // never silently proceed to check a hash against the wrong network.
      const result = await interpretSwapReceipt(testnetConfig, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
        fetchStatus: async () => {
          throw new Error("fetchStatus must not be called when the network guard fails");
        },
        assertNetwork: async () => {
          throw new Error("simulated network mismatch");
        },
      });
      assertEqual(result.status, "rpc_unavailable", "interpretSwapReceipt: execution-config/network guard failure fails closed as rpc_unavailable");
    }
    {
      const result = await interpretSwapReceipt(testnetConfig, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
        fetchStatus: async () => ({ status: "mined", receipt: makeReceipt({ status: "reverted" }) }),
        assertNetwork: async () => {},
      });
      assertEqual(result.status, "reverted", "interpretSwapReceipt: mined+reverted flows through to reverted");
    }
    {
      const result = await interpretSwapReceipt(testnetConfig, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
        fetchStatus: async () => ({
          status: "mined",
          receipt: makeReceipt({ to: "0x2222222222222222222222222222222222222222" }),
        }),
        assertNetwork: async () => {},
      });
      assertEqual(result.status, "unexpected_target", "interpretSwapReceipt: mined+success to the wrong router flows through to unexpected_target, never success");
    }
    {
      const result = await interpretSwapReceipt(testnetConfig, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
        fetchStatus: async () => ({ status: "mined", receipt: makeReceipt() }),
        assertNetwork: async () => {},
      });
      assertEqual(result.status, "success", "interpretSwapReceipt: mined+success to the correct router flows through to success");
    }

    // ═══ malformed PoolKey validation (no network - fails before any RPC read) ═
    {
      const result = await validatePoolKey({ ...AUDIT_FIXTURE_POOL_KEY, fee: -1 }, testnetConfig);
      assertEqual(result.ok, false, "negative fee is refused");
    }
    {
      const result = await validatePoolKey({ ...AUDIT_FIXTURE_POOL_KEY, fee: 16_777_216 }, testnetConfig);
      assertEqual(result.ok, false, "fee exceeding uint24 max is refused");
    }
    {
      const result = await validatePoolKey({ ...AUDIT_FIXTURE_POOL_KEY, fee: 1.5 }, testnetConfig);
      assertEqual(result.ok, false, "non-integer fee is refused");
    }
    {
      const result = await validatePoolKey({ ...AUDIT_FIXTURE_POOL_KEY, tickSpacing: 8_388_608 }, testnetConfig);
      assertEqual(result.ok, false, "tickSpacing exceeding int24 max is refused");
    }
    {
      const result = await validatePoolKey({ ...AUDIT_FIXTURE_POOL_KEY, tickSpacing: -8_388_609 }, testnetConfig);
      assertEqual(result.ok, false, "tickSpacing below int24 min is refused");
    }
    {
      const result = await validatePoolKey({ ...AUDIT_FIXTURE_POOL_KEY, tickSpacing: 1.5 }, testnetConfig);
      assertEqual(result.ok, false, "non-integer tickSpacing is refused");
    }
    {
      // None of the malformed-field cases above should ever throw an
      // uncaught exception - every call above already implicitly proves
      // this (an uncaught throw would crash this test script), but assert
      // explicitly that a clearly-invalid PoolKey still returns a well-formed result object.
      const result = await validatePoolKey({ ...AUDIT_FIXTURE_POOL_KEY, fee: NaN, tickSpacing: Infinity }, testnetConfig);
      assert(typeof result.ok === "boolean", "even a wildly malformed PoolKey (NaN/Infinity fields) returns a well-formed result, never throws");
      assertEqual(result.ok, false, "NaN fee / Infinity tickSpacing is refused");
    }

    // ═══ deadline validation ═════════════════════════════════════════════
    {
      const quote = makeBuyQuote();
      for (const bad of [-1, 0, NaN, Infinity, -Infinity, 1.5, 10 * 24 * 60 * 60]) {
        assertThrows(
          () => buildNativeBuyTransaction(testnetConfig, quote, { deadlineSeconds: bad }),
          `buildNativeBuyTransaction refuses deadlineSeconds=${bad}`
        );
      }
      const tx = buildNativeBuyTransaction(testnetConfig, quote, { deadlineSeconds: 60 });
      assert(!!tx, "buildNativeBuyTransaction accepts a valid, small positive deadlineSeconds");
    }

    // ═══ Permit2 expiration validation ═══════════════════════════════════
    {
      for (const bad of [-1, 0, NaN, Infinity, -Infinity, 1.5, 10 * 24 * 60 * 60]) {
        assertThrows(
          () =>
            buildPermit2AuthorizationTransaction(testnetConfig, AUDIT_FIXTURE_POOL_KEY.currency1, BigInt(1000), {
              expirationSeconds: bad,
            }),
          `buildPermit2AuthorizationTransaction refuses expirationSeconds=${bad}`
        );
      }
      const tx = buildPermit2AuthorizationTransaction(testnetConfig, AUDIT_FIXTURE_POOL_KEY.currency1, BigInt(1000), {
        expirationSeconds: 60,
      });
      assert(!!tx, "buildPermit2AuthorizationTransaction accepts a valid, small positive expirationSeconds");
    }

    // ═══ cross-network quote provenance ═══════════════════════════════════
    {
      const quote = makeBuyQuote(); // network: "testnet", chainId: 46630
      const tx = buildNativeBuyTransaction(testnetConfig, quote);
      assert(!!tx, "a testnet quote + testnet config is accepted");
    }
    {
      const quote = makeBuyQuote({ chainId: 999999 });
      assertThrows(
        () => buildNativeBuyTransaction(testnetConfig, quote),
        "buildNativeBuyTransaction refuses a quote whose chainId doesn't match the config's"
      );
    }
    {
      // A synthetic "mainnet" network label on the quote - proving the
      // guard, never a real usable mainnet execution config (none exists
      // in production code; resolveRobinhoodExecutionConfig("mainnet")
      // still fails closed, as already proven above).
      const quote = makeBuyQuote({ network: "mainnet" });
      assertThrows(
        () => buildNativeBuyTransaction(testnetConfig, quote),
        "buildNativeBuyTransaction refuses a quote whose network doesn't match the config's"
      );
    }
    {
      const quote = makeSellQuote({ chainId: 999999 });
      assertThrows(
        () => buildNativeSellTransaction(testnetConfig, quote),
        "buildNativeSellTransaction refuses a quote whose chainId doesn't match the config's"
      );
    }
    {
      // Execution-config/active-network mismatch fails closed for any
      // RPC-dependent operation - proven here via quoteSwap's own guard by
      // constructing a synthetic mismatched config (network label doesn't
      // match ROBINHOOD_NETWORK, which is "testnet" in this environment).
      // Not a real mainnet config - resolveRobinhoodExecutionConfig never
      // produces one; this is purely to prove the guard rejects mismatches.
      const mismatchedConfig: RobinhoodExecutionConfig = { ...testnetConfig, network: "mainnet", chainId: 4663 };
      const result = await quoteSwap({
        config: mismatchedConfig,
        poolKey: AUDIT_FIXTURE_POOL_KEY,
        side: "buy",
        amountIn: BigInt(1000),
        slippageBps: 500,
      });
      assertEqual(result.ok, false, "quoteSwap fails closed when config.network doesn't match the active ROBINHOOD_NETWORK, before any RPC read");
    }

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    if (failures !== 0) process.exitCode = 1;
  }


  await main();
}

async function robinhood_alpha(): Promise<void> {
  let failures = 0;
  function assert(c: boolean, label: string) {
    if (!c) {
      console.error(`[FAIL] ${label}`);
      failures++;
    } else console.log(`[PASS] ${label}`);
  }

  const tok = (addr: string, createdAt: number): RobinhoodDiscoveredToken =>
    ({ tokenAddress: addr, symbol: addr.slice(2, 6), name: "T", logo: null, launchpad: "pons", createdAt, chain: "robinhood" }) as unknown as RobinhoodDiscoveredToken;
  const safety = (passed: boolean): RobinhoodSafetyCheckResult =>
    ({ passed, reasons: passed ? [] : ["refused"], ownerRenounced: true, isBlacklistCapable: false, creatorHoldPct: 2, creatorHoldPolicyConfigured: true, hasSocialLink: true, metadata: {}, alphaWalletDetected: null, matchedAlphaWallets: [] }) as RobinhoodSafetyCheckResult;

  function deps(o: { failSecurity?: Set<string>; pass?: Set<string>; sources?: string[]; now: () => number; calls?: string[] }): RobinhoodAlphaDeps {
    return {
      now: o.now,
      discover: async () => ({ ok: true, tokens: [tok("0xaaaa", 1000), tok("0xbbbb", 2000), tok("0xcccc", 3000)] }),
      security: async (a) => (o.calls?.push(a), o.failSecurity?.has(a) ? { ok: false, reason: "provider_error", detail: "429" } : { ok: true, security: {} as never }),
      evaluate: async (t) => safety(o.pass?.has(t.tokenAddress) ?? false),
      houseConfig: async () => ({ entrySources: o.sources ?? ["gmgn"] }) as unknown as SniperConfig,
    };
  }

  async function main() {
    let t = 10_000_000;
    const now = () => t;

    __resetRobinhoodAlphaForTests();
    {
      const calls: string[] = [];
      const r = await getRobinhoodAlpha(deps({ now, pass: new Set(["0xbbbb"]), failSecurity: new Set(["0xcccc"]), calls }));
      assert(r.rows.length === 1 && r.rows[0].token === "0xbbbb", "only tokens that passed the house checks are listed");
      assert(r.rows[0].chain === "robinhood" && r.rows[0].safety.ownerRenounced === true, "rows carry EVM safety facts, chain=robinhood");
      assert(/security data unavailable/.test(r.error ?? ""), "missing security data surfaces as an error (fail closed)");
      assert(calls[0] === "0xcccc", "newest launches evaluated first");

      t += 10_000;
      const calls2: string[] = [];
      await getRobinhoodAlpha(deps({ now, pass: new Set(["0xbbbb", "0xcccc"]), calls: calls2 }));
      assert(calls2.length === 0, "no re-evaluation inside the 90s refresh window (rate-limit friendly)");

      t += 100_000;
      const calls3: string[] = [];
      const r3 = await getRobinhoodAlpha(deps({ now, pass: new Set(["0xbbbb", "0xcccc"]), calls: calls3 }));
      assert(calls3.join() === "0xcccc", "token with failed security is retried later; passed/refused ones are not re-fetched");
      assert(r3.rows.map((x) => x.token).sort().join() === "0xbbbb,0xcccc", "retried token listed once it passes");
    }

    __resetRobinhoodAlphaForTests();
    {
      const r = await getRobinhoodAlpha(deps({ now, sources: ["pump"] }));
      assert(r.rows.length === 0 && /gmgn/.test(r.error ?? ""), "house config without gmgn source → empty feed, explained");
    }

    __resetRobinhoodAlphaForTests();
    {
      const r = await getRobinhoodAlpha({ ...deps({ now }), discover: async () => ({ ok: false, reason: "provider_error", detail: "HTTP 429" }) });
      assert(r.rows.length === 0 && r.error === "provider_error", "GMGN discovery failure → empty feed with reason (never fabricated)");
    }

    const src = readFileSync(join(process.cwd(), "lib/alpha/robinhood-alpha.ts"), "utf8");
    assert(!/getDb|\.insert\(|\.update\(/.test(src), "feed never writes to the database");
    assert(/evaluateRobinhoodSafety/.test(src) && /getSniperConfig/.test(src), "uses the daemon's own safety evaluator with the house config");

    console.log(failures === 0 ? "\nAll Robinhood alpha tests passed." : `\n${failures} failure(s).`);
    if (failures !== 0) process.exitCode = 1;
  }

  await main();
}

async function runAll(): Promise<void> {
  console.log("\n=== robinhood-agent-signing ===");
  try {
    await robinhood_agent_signing();
  } catch (error) {
    console.error("[FAIL] test-robinhood-agent-signing threw:", error);
    process.exitCode = 1;
  }
  console.log("\n=== robinhood-agent-wallet-view ===");
  try {
    await robinhood_agent_wallet_view();
  } catch (error) {
    console.error("[FAIL] test-robinhood-agent-wallet-view threw:", error);
    process.exitCode = 1;
  }
  console.log("\n=== robinhood-broadcast ===");
  try {
    await robinhood_broadcast();
  } catch (error) {
    console.error("[FAIL] test-robinhood-broadcast threw:", error);
    process.exitCode = 1;
  }
  console.log("\n=== robinhood-v4-adapter ===");
  try {
    await robinhood_v4_adapter();
  } catch (error) {
    console.error("[FAIL] test-robinhood-v4-adapter threw:", error);
    process.exitCode = 1;
  }
  console.log("\n=== robinhood-alpha ===");
  try {
    await robinhood_alpha();
  } catch (error) {
    console.error("[FAIL] test-robinhood-alpha threw:", error);
    process.exitCode = 1;
  }
}

void runAll();
