/**
 * Uniswap v4 command/action encoding — PR08B.
 *
 * Low-level calldata construction for `UniversalRouter.execute()`,
 * scoped to exactly the sequence
 * `ROBINHOOD_SWAP_EXECUTION_AUDIT.md` §21d proved works against
 * Robinhood testnet: `V4_SWAP` → `SWAP_EXACT_IN_SINGLE` →
 * `SETTLE_ALL` → `TAKE_ALL`. No other commands are implemented here.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WRAP_ETH / UNWRAP_WETH are structurally absent from this module
 * ══════════════════════════════════════════════════════════════════════
 * The testnet router's WETH9 wiring is broken
 * (`TESTNET_ROUTER_WETH9_MISCONFIGURED_FOR_WRAP_PATH` — see
 * robinhood-execution-config.ts). This module never encodes a
 * `WRAP_ETH`/`UNWRAP_WETH` command byte, for any network — not because
 * of a runtime check, but because those command constants are simply
 * never referenced anywhere in this file. `assertNoWrapCommands` below
 * is a belt-and-suspenders runtime check on top of that, so a future
 * edit to this file that accidentally introduces one of those commands
 * fails loudly (in tests and at call time) instead of silently shipping.
 */

import { encodeAbiParameters, type Address, type Hex } from "viem";

import type { PoolKey } from "@/lib/chain/robinhood-v4-pool";

/** `Commands.sol` command bytes this module knows about. Only `V4_SWAP`
 * is ever emitted by the builders below — the others are listed only so
 * `assertNoWrapCommands` can name what it's checking for. */
const COMMAND_V4_SWAP = 0x10;
const COMMAND_WRAP_ETH = 0x0b;
const COMMAND_UNWRAP_WETH = 0x0c;

/** `Actions.sol` action bytes for the one sequence this module builds. */
const ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
const ACTION_SETTLE_ALL = 0x0c;
const ACTION_TAKE_ALL = 0x0f;

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

export type ExactInputSingleParams = {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
  hookData: Hex;
};

/**
 * Encodes the `[commands, inputs]` pair for
 * `UniversalRouter.execute(bytes commands, bytes[] inputs, uint256 deadline)`
 * for exactly one `SWAP_EXACT_IN_SINGLE` → `SETTLE_ALL` → `TAKE_ALL`
 * sequence — the only sequence this codebase has verified works
 * (`ROBINHOOD_SWAP_EXECUTION_AUDIT.md` §21d).
 *
 * `settleCurrency`/`takeCurrency` are passed explicitly (not derived
 * from `zeroForOne`) so a caller building a sell path can't get the
 * settle/take direction backwards by accident — see
 * `robinhood-v4-swap-tx.ts` for how buy vs. sell picks them.
 */
export function encodeV4SwapExactInSingle(params: {
  exactInputSingle: ExactInputSingleParams;
  settleCurrency: Address;
  settleMaxAmount: bigint;
  takeCurrency: Address;
  takeMinAmount: bigint;
}): { commands: Hex; inputs: Hex[] } {
  const exactInputSingleEncoded = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "poolKey", ...POOL_KEY_ABI_TYPE },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [params.exactInputSingle]
  );

  const settleEncoded = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [params.settleCurrency, params.settleMaxAmount]
  );

  const takeEncoded = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [params.takeCurrency, params.takeMinAmount]
  );

  const actions = byteArrayToHex([ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL]);

  const v4SwapInput = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actions, [exactInputSingleEncoded, settleEncoded, takeEncoded]]
  );

  const commands = byteArrayToHex([COMMAND_V4_SWAP]);

  return { commands, inputs: [v4SwapInput] };
}

function byteArrayToHex(bytes: number[]): Hex {
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

/**
 * Belt-and-suspenders runtime guard: throws if the supplied `commands`
 * bytes contain `WRAP_ETH` (0x0b) or `UNWRAP_WETH` (0x0c) anywhere.
 * Every swap-calldata builder in this package calls this immediately
 * before returning unsigned transaction data, so a future code change
 * that accidentally reintroduces a wrap/unwrap command on testnet fails
 * loudly instead of silently producing calldata that calls a
 * nonexistent WETH contract.
 *
 * Note: `ACTION_SETTLE_ALL` is `0x0c`, the SAME byte value as
 * `COMMAND_UNWRAP_WETH` — this is not a collision this function can be
 * confused by, because it only inspects the top-level `commands` byte
 * string (each byte there selects a whole command, e.g. `V4_SWAP`), never
 * the `actions` bytes nested inside a `V4_SWAP` input (which is a
 * separate encoding checked nowhere near command dispatch). Action bytes
 * are never passed to this function.
 */
export function assertNoWrapCommands(commands: Hex): void {
  const bytes = hexToByteArray(commands);
  if (bytes.includes(COMMAND_WRAP_ETH)) {
    throw new Error(
      "assertNoWrapCommands: WRAP_ETH (0x0b) command byte found — testnet's router WETH9 " +
        "is misconfigured (points at mainnet WETH, no code on testnet); this command must never be emitted."
    );
  }
  if (bytes.includes(COMMAND_UNWRAP_WETH)) {
    throw new Error(
      "assertNoWrapCommands: UNWRAP_WETH (0x0c) command byte found — testnet's router WETH9 " +
        "is misconfigured (points at mainnet WETH, no code on testnet); this command must never be emitted."
    );
  }
}

function hexToByteArray(hex: Hex): number[] {
  const clean = hex.slice(2);
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
}
