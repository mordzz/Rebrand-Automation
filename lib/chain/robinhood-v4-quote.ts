/**
 * Uniswap v4 native-ETH quote adapter — PR08B.
 *
 * Read-only. Calls the real, deployed v4 `Quoter` contract via a
 * non-persistent `eth_call` (`quoteExactInputSingle`), exactly the call
 * `ROBINHOOD_SWAP_EXECUTION_AUDIT.md` §20e/§21c already proved succeeds
 * against real testnet pools. No signing, no transaction, no state
 * change.
 */

import { getRobinhoodPublicClient } from "@/lib/chain/rpc";
import type { RobinhoodExecutionConfig } from "@/lib/chain/robinhood-execution-config";
import {
  NATIVE_CURRENCY,
  validatePoolKey,
  type PoolKey,
  type VerifiedPool,
} from "@/lib/chain/robinhood-v4-pool";
import { computeAmountOutMinimum } from "@/lib/chain/robinhood-v4-slippage";

export type SwapSide = "buy" | "sell";

export type QuoteSwapInput = {
  config: RobinhoodExecutionConfig;
  /** Explicitly-verified PoolKey — see robinhood-v4-pool.ts for why this
   * adapter does not discover pools itself. */
  poolKey: PoolKey;
  /** "buy" = native ETH -> token; "sell" = token -> native ETH. Which
   * currency is the input is derived from the PoolKey + side, never
   * guessed. */
  side: SwapSide;
  /** Input amount, in the input currency's own base units (wei for a
   * buy, the token's own smallest unit for a sell). Always a bigint —
   * never a floating-point SOL/ETH-style decimal. */
  amountIn: bigint;
  /** Basis points, e.g. 500 = 5%. Must be Noah's already-resolved
   * slippage value — this module does not read SniperConfig itself. */
  slippageBps: number;
};

export type QuoteSwapResult =
  | {
      ok: true;
      quote: {
        pool: VerifiedPool;
        side: SwapSide;
        zeroForOne: boolean;
        amountIn: bigint;
        amountOutQuoted: bigint;
        amountOutMinimum: bigint;
        quoterGasEstimate: bigint;
        /** The currency the caller is paying with. */
        currencyIn: `0x${string}`;
        /** The currency the caller receives. */
        currencyOut: `0x${string}`;
      };
    }
  | { ok: false; reason: string };

const QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

/**
 * Quotes a native-ETH v4 swap and derives `amountOutMinimum` from the
 * caller-supplied `slippageBps`. Fails closed — never fabricates a quote
 * — on: an invalid/unliquid pool (validatePoolKey), a reverted Quoter
 * call, or an invalid slippage value.
 */
export async function quoteSwap(input: QuoteSwapInput): Promise<QuoteSwapResult> {
  if (input.amountIn <= BigInt(0)) {
    return { ok: false, reason: `amountIn must be positive, got ${input.amountIn}` };
  }

  const validated = await validatePoolKey(input.poolKey, input.config);
  if (!validated.ok) return { ok: false, reason: `pool validation failed: ${validated.reason}` };
  const { pool } = validated;

  // "buy" always means native ETH is the input; "sell" always means the
  // token is. zeroForOne is derived from which side of the PoolKey
  // native ETH sits on — never assumed to be currency0.
  const nativeIsCurrency0 = pool.poolKey.currency0 === NATIVE_CURRENCY;
  const zeroForOne = input.side === "buy" ? nativeIsCurrency0 : !nativeIsCurrency0;
  const currencyIn = zeroForOne ? pool.poolKey.currency0 : pool.poolKey.currency1;
  const currencyOut = zeroForOne ? pool.poolKey.currency1 : pool.poolKey.currency0;

  if (input.side === "buy" && currencyIn !== NATIVE_CURRENCY) {
    return { ok: false, reason: "side=buy requires native ETH to be the input currency for this PoolKey" };
  }
  if (input.side === "sell" && currencyOut !== NATIVE_CURRENCY) {
    return { ok: false, reason: "side=sell requires native ETH to be the output currency for this PoolKey" };
  }
  if (!pool.isHookless) {
    return {
      ok: false,
      reason:
        `pool ${pool.poolId} has a non-zero hook (${pool.poolKey.hooks}) — this adapter does not ` +
        `invent hookData and only supports hookless pools today`,
    };
  }

  const client = getRobinhoodPublicClient();
  let amountOutQuoted: bigint;
  let quoterGasEstimate: bigint;
  try {
    const { result } = await client.simulateContract({
      address: input.config.quoter,
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey: pool.poolKey,
          zeroForOne,
          exactAmount: input.amountIn,
          // Empty hookData for a hookless pool. A hooked pool's required
          // hookData is not invented — see robinhood-v4-pool.ts; callers
          // must not pass a hooked PoolKey to this function today.
          hookData: "0x",
        },
      ],
    });
    [amountOutQuoted, quoterGasEstimate] = result;
  } catch (error) {
    return {
      ok: false,
      reason: `Quoter call reverted or failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const minOut = computeAmountOutMinimum(amountOutQuoted, input.slippageBps);
  if (!minOut.ok) return { ok: false, reason: `slippage calculation failed: ${minOut.reason}` };

  return {
    ok: true,
    quote: {
      pool,
      side: input.side,
      zeroForOne,
      amountIn: input.amountIn,
      amountOutQuoted,
      amountOutMinimum: minOut.amountOutMinimum,
      quoterGasEstimate,
      currencyIn,
      currencyOut,
    },
  };
}
