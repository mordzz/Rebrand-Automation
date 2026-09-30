/**
 * Uniswap v4 pool resolution — PR08B.
 *
 * Deliberately NOT a general-purpose pool-discovery algorithm. Finding
 * "the" v4 pool for an arbitrary token requires either an indexer (GMGN
 * doesn't expose v4 pool data for Robinhood — it wasn't even the source
 * this repo's testnet v4 pools were found through; they were found by a
 * raw `PoolManager.Initialize` event scan in
 * `ROBINHOOD_SWAP_EXECUTION_AUDIT.md`) or scanning a very large block
 * range that the testnet public RPC cannot serve in full (it is not an
 * archive node — same audit, §14). Building a fake/best-guess discovery
 * algorithm on top of that would be exactly the kind of invented
 * behavior this PR must not add.
 *
 * Instead: this module validates an EXPLICITLY-SUPPLIED PoolKey against
 * real on-chain state (StateView) and fails closed if the pool doesn't
 * exist, isn't initialized, or has no liquidity. A future PR that adds
 * real pool discovery (e.g. backed by an indexer, or GMGN once it
 * exposes Robinhood v4 pool data) can build on top of this validator
 * without changing its contract.
 */

import { encodeAbiParameters, isAddress, keccak256, zeroAddress, type Address } from "viem";

import { getRobinhoodPublicClient } from "@/lib/chain/rpc";
import type { RobinhoodExecutionConfig } from "@/lib/chain/robinhood-execution-config";

/** v4's native-currency sentinel — NOT a WETH address. See
 * robinhood-execution-config.ts's module comment for why this codebase
 * never substitutes WETH for this on testnet. */
export const NATIVE_CURRENCY: Address = zeroAddress;

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type VerifiedPool = {
  poolId: `0x${string}`;
  poolKey: PoolKey;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  /** True when `hooks === address(0)` — a vanilla pool. A non-zero hook
   * means execution may depend on that hook's own logic, which this
   * module does not inspect or validate. */
  isHookless: boolean;
};

const POOL_KEY_ABI_TYPE = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

const STATE_VIEW_ABI = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    type: "function",
    name: "getLiquidity",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
] as const;

/** v4's `PoolId` is `keccak256(abi.encode(poolKey))` — the same
 * derivation `PoolManager`/`StateView` use internally. Computing it here
 * (rather than requiring the caller to supply it) means a caller can
 * never pass a `poolId` that doesn't actually correspond to the
 * `poolKey` they also passed. */
export function computePoolId(poolKey: PoolKey): `0x${string}` {
  const encoded = encodeAbiParameters([POOL_KEY_ABI_TYPE], [poolKey]);
  return keccak256(encoded);
}

export type PoolValidationResult =
  | { ok: true; pool: VerifiedPool }
  | { ok: false; reason: string };

/**
 * Validates an explicitly-supplied PoolKey against real on-chain state.
 * Fails closed (never returns a pool) if:
 *   - either currency isn't a valid address (or, if claiming to be
 *     native, isn't exactly the zero address)
 *   - the pool has never been initialized (sqrtPriceX96 == 0)
 *   - the pool has zero liquidity
 *
 * Never invents a PoolKey — the caller must supply one obtained from a
 * verified source (a prior on-chain scan, a future discovery module, or
 * a hand-verified fixture during testing).
 */
export async function validatePoolKey(
  poolKey: PoolKey,
  config: RobinhoodExecutionConfig
): Promise<PoolValidationResult> {
  if (poolKey.currency0 !== NATIVE_CURRENCY && !isAddress(poolKey.currency0)) {
    return { ok: false, reason: `currency0 "${poolKey.currency0}" is not a valid address` };
  }
  if (poolKey.currency1 !== NATIVE_CURRENCY && !isAddress(poolKey.currency1)) {
    return { ok: false, reason: `currency1 "${poolKey.currency1}" is not a valid address` };
  }
  if (!isAddress(poolKey.hooks)) {
    return { ok: false, reason: `hooks "${poolKey.hooks}" is not a valid address` };
  }
  if (poolKey.currency0 === poolKey.currency1) {
    return { ok: false, reason: "currency0 and currency1 must differ" };
  }
  if (poolKey.currency0 !== NATIVE_CURRENCY && poolKey.currency1 !== NATIVE_CURRENCY) {
    // Not a hard on-chain requirement, but this adapter only implements
    // the native-ETH path (see module doc comment) — a token/token pool
    // is out of scope until a WETH-safe (mainnet, or a fixed testnet
    // router) path is verified.
    return {
      ok: false,
      reason:
        "neither currency is native ETH (address(0)) — this adapter only implements the verified native-ETH v4 path",
    };
  }

  const client = getRobinhoodPublicClient();
  const poolId = computePoolId(poolKey);

  let slot0: readonly [bigint, number, number, number];
  let liquidity: bigint;
  try {
    [slot0, liquidity] = await Promise.all([
      client.readContract({
        address: config.stateView,
        abi: STATE_VIEW_ABI,
        functionName: "getSlot0",
        args: [poolId],
      }),
      client.readContract({
        address: config.stateView,
        abi: STATE_VIEW_ABI,
        functionName: "getLiquidity",
        args: [poolId],
      }),
    ]);
  } catch (error) {
    return {
      ok: false,
      reason: `StateView read failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const [sqrtPriceX96, tick] = slot0;
  if (sqrtPriceX96 === BigInt(0)) {
    return { ok: false, reason: `pool ${poolId} has never been initialized (sqrtPriceX96 == 0)` };
  }
  if (liquidity <= BigInt(0)) {
    return { ok: false, reason: `pool ${poolId} has zero liquidity — refusing to quote/build against it` };
  }

  return {
    ok: true,
    pool: {
      poolId,
      poolKey,
      liquidity,
      sqrtPriceX96,
      tick,
      isHookless: poolKey.hooks === NATIVE_CURRENCY,
    },
  };
}
