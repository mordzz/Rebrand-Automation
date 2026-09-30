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

import type { RobinhoodNetwork } from "@/lib/chain/config";

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
      "Robinhood mainnet v4 execution addresses (PoolManager/Quoter/StateView) " +
      "have not been independently verified on-chain by this codebase — only " +
      "task-supplied addresses exist, and Uniswap v3 (not v4) mainnet contracts " +
      "were the ones actually eth_getCode-confirmed in ROBINHOOD_SWAP_EXECUTION_AUDIT.md. " +
      "Failing closed rather than guessing; see that audit before adding mainnet v4 addresses here.",
  };
}
