/**
 * Robinhood Chain v4 swap execution configuration — PR08B.
 *
 * Network-specific contract addresses for the ONLY execution path this
 * codebase has actually proven works: Uniswap v4's native-currency
 * (address(0)) path through `UniversalRouter`'s `V4_SWAP` command,
 * verified read-only against Robinhood testnet in
 * `ROBINHOOD_SWAP_EXECUTION_AUDIT.md` (§20/§21).
 *
 * ══════════════════════════════════════════════════════════════════════
 * CRITICAL: testnet WETH9 is broken, and this module never uses it
 * ══════════════════════════════════════════════════════════════════════
 * The audit proved (via decoded constructor bytecode + a successful
 * native-ETH swap simulation) that the testnet `UniversalRouter`'s
 * configured `WETH9` immutable points at Robinhood **mainnet**'s WETH
 * address, which has no bytecode on testnet
 * (`TESTNET_ROUTER_WETH9_MISCONFIGURED_FOR_WRAP_PATH`). This module does
 * NOT expose a testnet WETH address at all, and the only supported
 * `mode` is `"native_v4"` — native ETH represented as `address(0)` in a
 * v4 `PoolKey`, which settles via `msg.value` directly in `PoolManager`
 * and never touches the router's WETH9 field. Callers building calldata
 * from this config must never add a `WRAP_ETH`/`UNWRAP_WETH` command for
 * testnet — see `lib/chain/robinhood-v4-actions.ts`'s
 * `assertNoWrapCommands`, which every swap-calldata builder in this
 * package runs before returning.
 *
 * ══════════════════════════════════════════════════════════════════════
 * Mainnet fails closed
 * ══════════════════════════════════════════════════════════════════════
 * The audit independently verified (via `eth_getCode`) a set of Uniswap
 * **v3** contracts on Robinhood mainnet, but this adapter implements the
 * **v4** native-currency path specifically — mainnet v4 core contracts
 * (PoolManager/Quoter for chain 4663) were never independently confirmed
 * on-chain by this repo (only task-supplied addresses, unverified here).
 * Per the standing "fail closed rather than guess" rule, mainnet
 * resolves to `ok: false` until that verification exists — this is a
 * deliberate gap, not an oversight.
 */

import type { PublicClient } from "viem";

import { ROBINHOOD_CHAIN_ID, ROBINHOOD_NETWORK, type RobinhoodNetwork } from "@/lib/chain/config";
import { assertCorrectChain, getRobinhoodPublicClient, RobinhoodRpcError } from "@/lib/chain/rpc";

export type RobinhoodExecutionMode = "native_v4";

export type RobinhoodExecutionConfig = {
  network: RobinhoodNetwork;
  chainId: number;
  /** Uniswap v4 singleton pool ledger. */
  poolManager: `0x${string}`;
  /** Uniswap v4 Quoter — read-only, used for `quoteExactInputSingle`. */
  quoter: `0x${string}`;
  /** Uniswap v4 StateView — read-only pool-state reads (slot0/liquidity). */
  stateView: `0x${string}`;
  /** Entry point for constructed (unsigned) swap calldata. */
  universalRouter: `0x${string}`;
  /** Permit2 — used only for the ERC-20-input (sell) approval path;
   * never for the native-ETH-input (buy) path, which needs no approval
   * at all. */
  permit2: `0x${string}`;
  /** Always `"native_v4"` today — see module doc comment. There is no
   * wrapped-native (WETH) mode: it is not configured because it is not
   * usable on testnet, and was never independently verified on mainnet. */
  mode: RobinhoodExecutionMode;
};

const TESTNET_CONFIG: RobinhoodExecutionConfig = {
  network: "testnet",
  chainId: 46630,
  // All four addresses below are exactly the ones independently
  // confirmed via eth_getCode + exposed getters in
  // ROBINHOOD_SWAP_EXECUTION_AUDIT.md §20a/§20b/§20d/§21 — not copied
  // from generic Ethereum/Arbitrum defaults.
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
  stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
  universalRouter: "0x8876789976dEcBfCbBbe364623C63652db8C0904",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  mode: "native_v4",
};

/**
 * Robinhood MAINNET (chain 4663) Uniswap v4 contracts — READINESS ONLY.
 *
 * Source: Uniswap's own v4 deployments page, section "Robinhood Chain: 4663"
 * (developers.uniswap.org/docs/protocols/v4/deployments, read 2026-10-01),
 * with Blockscout links on robinhoodchain.blockscout.com. Independently
 * verified read-only against https://rpc.mainnet.chain.robinhood.com:
 *   - eth_chainId == 4663
 *   - eth_getCode non-empty for every address below
 *   - poolManager() on Quoter / StateView / PositionManager / both
 *     UniversalRouters returns exactly `poolManager` below
 *   - Permit2 DOMAIN_SEPARATOR() callable
 *   - WETH / USDG match docs.robinhood.com/chain/contracts
 *   - read-only Quoter eth_call on hookless native-ETH/USDG pools priced
 *     ETH ≈ $2,710 (sane)
 * A third router address seen only in a docs PR snippet
 * (0x06afBA43…F99) has code but its poolManager() reverts — NOT used.
 *
 * This constant is deliberately NOT returned by
 * resolveRobinhoodExecutionConfig: mainnet execution stays disabled until
 * explicit operator approval and a controlled mainnet canary.
 */
export const ROBINHOOD_MAINNET_V4_VERIFIED = {
  chainId: 4663,
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
  stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
  positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  /** Same router address the PR10 testnet canary executed through. */
  universalRouter: "0x8876789976dEcBfCbBbe364623C63652db8C0904",
  /** Listed as "Universal Router 2.1.2"; verified, not selected. */
  universalRouterV2_1_2: "0x204FAca1764B154221e35c0d20aBb3c525710498",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  /** Documented smoke-quote pool: native ETH / USDG, fee 500, ts 10, hookless. */
  smokePool: {
    poolId: "0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982",
    currency0: "0x0000000000000000000000000000000000000000",
    currency1: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    fee: 500,
    tickSpacing: 10,
    hooks: "0x0000000000000000000000000000000000000000",
  },
} as const;

export type RobinhoodExecutionConfigResult =
  | { ok: true; config: RobinhoodExecutionConfig }
  | { ok: false; reason: string };

/**
 * Resolves the v4 execution contract set for a network, or fails closed
 * with an explicit reason. Never guesses, never falls back to another
 * network's addresses.
 */
export function resolveRobinhoodExecutionConfig(
  network: RobinhoodNetwork
): RobinhoodExecutionConfigResult {
  if (network === "testnet") return { ok: true, config: TESTNET_CONFIG };

  return {
    ok: false,
    reason:
      "Robinhood mainnet execution is disabled. Mainnet v4 contracts are verified " +
      "(ROBINHOOD_MAINNET_V4_VERIFIED, readiness only) but mainnet state-changing " +
      "execution requires explicit operator approval and a controlled mainnet canary.",
  };
}

/**
 * Execution-context invariant: every RPC-dependent PR08B operation
 * (pool validation, quoting, allowance reads, receipt interpretation)
 * must call this before touching the network. Fails closed if:
 *   - the supplied `config` wasn't resolved for the process's actually
 *     active network (`ROBINHOOD_NETWORK`/`ROBINHOOD_CHAIN_ID` from
 *     lib/chain/config.ts) — this prevents a caller from constructing or
 *     passing around a mismatched config (e.g. testnet addresses while
 *     the process is pointed at mainnet, or vice versa)
 *   - the RPC endpoint itself doesn't actually report that chain id
 *     (the existing PR03 `assertCorrectChain` check) — this prevents a
 *     misconfigured `ROBINHOOD_RPC_URL` from silently serving the wrong
 *     chain's state under an otherwise-correct config object
 *
 * Never silently proceeds on a mismatch in either direction.
 */
export async function assertExecutionConfigOnActiveNetwork(
  config: RobinhoodExecutionConfig,
  client: PublicClient = getRobinhoodPublicClient()
): Promise<void> {
  if (config.network !== ROBINHOOD_NETWORK || config.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new RobinhoodRpcError(
      "wrong_chain",
      `Execution config is for ${config.network}/chainId ${config.chainId}, but the active ` +
        `Robinhood network is ${ROBINHOOD_NETWORK}/chainId ${ROBINHOOD_CHAIN_ID}. Refusing to use ` +
        `a mismatched network's execution addresses.`
    );
  }
  await assertCorrectChain(client);
}
