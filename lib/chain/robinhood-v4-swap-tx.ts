/**
 * Unsigned Robinhood v4 swap/approval transaction construction — PR08B.
 *
 * Produces `{ to, data, value }` objects only. Nothing here signs,
 * derives an account, reads a nonce, or calls
 * `eth_sendRawTransaction`/`sendTransaction` — that is PR09's job. Every
 * builder in this file is a pure function of its inputs plus read-only
 * RPC calls (allowance/gas-estimate reads), and can be exercised with
 * `eth_call`/`eth_estimateGas` for simulation, exactly as
 * `ROBINHOOD_SWAP_EXECUTION_AUDIT.md` §21d did by hand.
 */

import { encodeFunctionData, type Address, type Hex } from "viem";

import { getRobinhoodPublicClient } from "@/lib/chain/rpc";
import {
  assertExecutionConfigOnActiveNetwork,
  type RobinhoodExecutionConfig,
} from "@/lib/chain/robinhood-execution-config";
import { NATIVE_CURRENCY } from "@/lib/chain/robinhood-v4-pool";
import { assertNoWrapCommands, encodeV4SwapExactInSingle } from "@/lib/chain/robinhood-v4-actions";
import type { QuoteSwapResult } from "@/lib/chain/robinhood-v4-quote";

export type UnsignedTransaction = {
  chainId: number;
  to: Address;
  data: Hex;
  /** Wei to attach — non-zero only for a native-ETH-input (buy) swap.
   * Always 0n for an ERC-20 approval or a sell-side swap. */
  value: bigint;
};

export type UnsignedSwapTransaction = UnsignedTransaction & {
  deadline: bigint;
  amountIn: bigint;
  amountOutMinimum: bigint;
};

const DEFAULT_DEADLINE_SECONDS = 1200; // 20 minutes — matches the window used in the audit's live simulation
/** A generous but finite upper bound (7 days) — rejects absurd/overflow
 * values without constraining any legitimate use of this adapter. */
const MAX_DEADLINE_SECONDS = 7 * 24 * 60 * 60;

/** Permit2's `amount` field is `uint160` — `2**160 - 1`. */
const UINT160_MAX = BigInt("0xffffffffffffffffffffffffffffffffffffff");
/** Permit2's `expiration` field is `uint48` — `2**48 - 1`. */
const UINT48_MAX = BigInt("0xffffffffffff");

/** Validates a caller-supplied `deadlineSeconds`/`expirationSeconds`
 * option before it's used in any arithmetic. Fails closed on anything
 * that isn't a finite positive integer within a sane bound — never lets
 * a negative, zero, NaN, Infinity, or absurdly large value silently
 * produce a nonsensical or overflowing deadline. */
function validateBoundedSeconds(seconds: number, label: string): number {
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds)) {
    throw new Error(`${label} must be a finite integer, got ${seconds}`);
  }
  if (seconds <= 0) {
    throw new Error(`${label} must be positive, got ${seconds}`);
  }
  if (seconds > MAX_DEADLINE_SECONDS) {
    throw new Error(`${label} exceeds the maximum bound of ${MAX_DEADLINE_SECONDS}s, got ${seconds}`);
  }
  return seconds;
}

function deadlineFromNow(seconds: number = DEFAULT_DEADLINE_SECONDS): bigint {
  const validated = validateBoundedSeconds(seconds, "deadlineSeconds");
  return BigInt(Math.floor(Date.now() / 1000) + validated);
}

/**
 * A quote produced against one network's execution config must never be
 * handed to a builder constructing calldata against a different
 * network's config — that could target the wrong chain's router with
 * the wrong chain's PoolKey/addresses. Checked here at runtime (not left
 * as a TypeScript-only guarantee) since `quote` and `config` are two
 * independent values a caller could mismatch.
 */
function assertQuoteMatchesConfigNetwork(
  quote: { network: RobinhoodExecutionConfig["network"]; chainId: number },
  config: RobinhoodExecutionConfig
): void {
  if (quote.network !== config.network || quote.chainId !== config.chainId) {
    throw new Error(
      `quote was produced for ${quote.network}/chainId ${quote.chainId}, but this builder was called with a ` +
        `config for ${config.network}/chainId ${config.chainId} — refusing to build calldata across networks`
    );
  }
}

const UNIVERSAL_ROUTER_EXECUTE_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/**
 * Builds unsigned calldata for a native-ETH → token swap
 * (`quote.side === "buy"`), using exactly the command/action sequence
 * proven in the audit: `V4_SWAP` → `SWAP_EXACT_IN_SINGLE` →
 * `SETTLE_ALL` → `TAKE_ALL`. No `WRAP_ETH`, no WETH dependency —
 * `assertNoWrapCommands` is run before returning as a hard guarantee.
 */
export function buildNativeBuyTransaction(
  config: RobinhoodExecutionConfig,
  quote: Extract<QuoteSwapResult, { ok: true }>["quote"],
  options?: { deadlineSeconds?: number }
): UnsignedSwapTransaction {
  if (quote.side !== "buy") {
    throw new Error(`buildNativeBuyTransaction requires quote.side === "buy", got "${quote.side}"`);
  }
  assertQuoteMatchesConfigNetwork(quote, config);
  if (quote.currencyIn !== NATIVE_CURRENCY) {
    throw new Error("buildNativeBuyTransaction requires the quote's input currency to be native ETH");
  }
  if (quote.amountOutMinimum <= BigInt(0)) {
    throw new Error("buildNativeBuyTransaction refuses a zero/negative amountOutMinimum");
  }

  const { commands, inputs } = encodeV4SwapExactInSingle({
    exactInputSingle: {
      poolKey: quote.pool.poolKey,
      zeroForOne: quote.zeroForOne,
      amountIn: quote.amountIn,
      amountOutMinimum: quote.amountOutMinimum,
      hookData: "0x",
    },
    settleCurrency: quote.currencyIn,
    settleMaxAmount: quote.amountIn,
    takeCurrency: quote.currencyOut,
    takeMinAmount: quote.amountOutMinimum,
  });

  assertNoWrapCommands(commands);

  const deadline = deadlineFromNow(options?.deadlineSeconds);
  const data = encodeFunctionData({
    abi: UNIVERSAL_ROUTER_EXECUTE_ABI,
    functionName: "execute",
    args: [commands, inputs, deadline],
  });

  return {
    chainId: config.chainId,
    to: config.universalRouter,
    data,
    value: quote.amountIn, // msg.value === amountIn, native ETH attached directly — no WRAP_ETH
    deadline,
    amountIn: quote.amountIn,
    amountOutMinimum: quote.amountOutMinimum,
  };
}

/**
 * Builds unsigned calldata for a token → native-ETH swap
 * (`quote.side === "sell"`). Requires the caller to already hold a
 * sufficient Permit2 allowance for `config.universalRouter` — this
 * function does NOT build or check that allowance itself; see
 * `checkErc20AllowanceToPermit2`/`checkPermit2AllowanceToRouter` and
 * `buildErc20ApprovalTransaction`/`buildPermit2AuthorizationTransaction`
 * below for the two prerequisite unsigned steps. No `UNWRAP_WETH` is
 * ever emitted — the swap's output settles as native ETH directly.
 */
export function buildNativeSellTransaction(
  config: RobinhoodExecutionConfig,
  quote: Extract<QuoteSwapResult, { ok: true }>["quote"],
  options?: { deadlineSeconds?: number }
): UnsignedSwapTransaction {
  if (quote.side !== "sell") {
    throw new Error(`buildNativeSellTransaction requires quote.side === "sell", got "${quote.side}"`);
  }
  assertQuoteMatchesConfigNetwork(quote, config);
  if (quote.currencyOut !== NATIVE_CURRENCY) {
    throw new Error("buildNativeSellTransaction requires the quote's output currency to be native ETH");
  }
  if (quote.amountOutMinimum <= BigInt(0)) {
    throw new Error("buildNativeSellTransaction refuses a zero/negative amountOutMinimum");
  }

  const { commands, inputs } = encodeV4SwapExactInSingle({
    exactInputSingle: {
      poolKey: quote.pool.poolKey,
      zeroForOne: quote.zeroForOne,
      amountIn: quote.amountIn,
      amountOutMinimum: quote.amountOutMinimum,
      hookData: "0x",
    },
    settleCurrency: quote.currencyIn, // the ERC-20 token — pulled via Permit2 inside SETTLE_ALL
    settleMaxAmount: quote.amountIn,
    takeCurrency: quote.currencyOut, // native ETH
    takeMinAmount: quote.amountOutMinimum,
  });

  assertNoWrapCommands(commands);

  const deadline = deadlineFromNow(options?.deadlineSeconds);
  const data = encodeFunctionData({
    abi: UNIVERSAL_ROUTER_EXECUTE_ABI,
    functionName: "execute",
    args: [commands, inputs, deadline],
  });

  return {
    chainId: config.chainId,
    to: config.universalRouter,
    data,
    value: BigInt(0), // no native ETH attached on a sell — input is the ERC-20 token
    deadline,
    amountIn: quote.amountIn,
    amountOutMinimum: quote.amountOutMinimum,
  };
}

// ── Sell-path prerequisites: ERC-20 → Permit2 → UniversalRouter ────────

const ERC20_ABI = [
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
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const PERMIT2_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
] as const;

/** Reads the standard ERC-20 allowance from `owner` to Permit2. */
export async function checkErc20AllowanceToPermit2(
  config: RobinhoodExecutionConfig,
  token: Address,
  owner: Address
): Promise<bigint> {
  const client = getRobinhoodPublicClient();
  await assertExecutionConfigOnActiveNetwork(config, client);
  return client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, config.permit2],
  });
}

/** Reads Permit2's own allowance record for (owner, token, spender). */
export async function checkPermit2AllowanceToRouter(
  config: RobinhoodExecutionConfig,
  token: Address,
  owner: Address
): Promise<{ amount: bigint; expiration: number; nonce: number }> {
  const client = getRobinhoodPublicClient();
  await assertExecutionConfigOnActiveNetwork(config, client);
  const [amount, expiration, nonce] = await client.readContract({
    address: config.permit2,
    abi: PERMIT2_ABI,
    functionName: "allowance",
    args: [owner, token, config.universalRouter],
  });
  return { amount, expiration, nonce };
}

/**
 * Step A of the sell-path prerequisite: unsigned ERC-20
 * `approve(Permit2, amount)`. Exact-amount only — never
 * `type(uint256).max` — per the standing "minimum safe approval" rule.
 */
export function buildErc20ApprovalTransaction(
  config: RobinhoodExecutionConfig,
  token: Address,
  amount: bigint
): UnsignedTransaction {
  if (amount <= BigInt(0)) throw new Error("buildErc20ApprovalTransaction refuses a zero/negative amount");
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [config.permit2, amount],
  });
  return { chainId: config.chainId, to: token, data, value: BigInt(0) };
}

/**
 * Step B of the sell-path prerequisite: unsigned Permit2
 * `approve(token, UniversalRouter, amount, expiration)`. Exact-amount
 * only, and a bounded expiration — never an unlimited/far-future grant
 * by default.
 */
export function buildPermit2AuthorizationTransaction(
  config: RobinhoodExecutionConfig,
  token: Address,
  amount: bigint,
  options?: { expirationSeconds?: number }
): UnsignedTransaction {
  if (amount <= BigInt(0)) throw new Error("buildPermit2AuthorizationTransaction refuses a zero/negative amount");
  if (amount > UINT160_MAX) {
    // Permit2's `amount` field is uint160 — reject anything that
    // wouldn't fit rather than silently truncating.
    throw new Error("buildPermit2AuthorizationTransaction: amount exceeds uint160 range");
  }
  const expirationSeconds = validateBoundedSeconds(
    options?.expirationSeconds ?? DEFAULT_DEADLINE_SECONDS,
    "expirationSeconds"
  );
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiration = nowSeconds + expirationSeconds;
  if (BigInt(expiration) > UINT48_MAX) {
    throw new Error(
      `buildPermit2AuthorizationTransaction: computed expiration ${expiration} exceeds uint48 range`
    );
  }
  if (expiration <= nowSeconds) {
    // Unreachable given validateBoundedSeconds already requires a
    // positive expirationSeconds, but checked explicitly so this
    // invariant is enforced at the point it matters, not just implied.
    throw new Error("buildPermit2AuthorizationTransaction: computed expiration must be in the future");
  }
  const data = encodeFunctionData({
    abi: PERMIT2_ABI,
    functionName: "approve",
    args: [token, config.universalRouter, amount, expiration],
  });
  return { chainId: config.chainId, to: config.permit2, data, value: BigInt(0) };
}
