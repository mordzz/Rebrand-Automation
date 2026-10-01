/**
 * Deterministic tests for the PR08B Robinhood Chain v4 execution adapter:
 * lib/chain/robinhood-execution-config.ts, robinhood-v4-pool.ts (pure
 * parts), robinhood-v4-actions.ts, robinhood-v4-slippage.ts,
 * robinhood-v4-swap-tx.ts, robinhood-v4-receipt.ts.
 *
 * No network calls - everything here is pure-function or synthetic-input
 * testing. The one thing this file cannot exercise without a live RPC
 * (validatePoolKey / quoteSwap against real chain state) is covered by
 * scripts/test-robinhood-v4-live.ts instead. Same plain-tsx-script
 * convention as scripts/test-robinhood-safety.ts.
 *
 * Run: npm run test:robinhood-v4-adapter
 */
import { isAddress, type TransactionReceipt } from "viem";

import {
  resolveRobinhoodExecutionConfig,
  type RobinhoodExecutionConfig,
} from "@/lib/chain/robinhood-execution-config";
import {
  computePoolId,
  NATIVE_CURRENCY,
  validatePoolKey,
  type PoolKey,
  type VerifiedPool,
} from "@/lib/chain/robinhood-v4-pool";
import { assertNoWrapCommands, encodeV4SwapExactInSingle } from "@/lib/chain/robinhood-v4-actions";
import { computeAmountOutMinimum, MAX_SLIPPAGE_BPS } from "@/lib/chain/robinhood-v4-slippage";
import { quoteSwap, type QuoteSwapResult } from "@/lib/chain/robinhood-v4-quote";
import {
  buildErc20ApprovalTransaction,
  buildNativeBuyTransaction,
  buildNativeSellTransaction,
  buildPermit2AuthorizationTransaction,
} from "@/lib/chain/robinhood-v4-swap-tx";
import { interpretMinedReceipt, interpretSwapReceipt } from "@/lib/chain/robinhood-v4-receipt";
import { RobinhoodRpcError } from "@/lib/chain/rpc";

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
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
