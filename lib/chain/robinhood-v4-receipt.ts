/**
 * Robinhood v4 swap receipt interpretation — PR08B.
 *
 * Given a transaction hash (that PR09/PR10 broadcast — this module never
 * broadcasts anything itself), determines what actually happened
 * on-chain. Builds on `lib/chain/rpc.ts#getTransactionStatus`, which
 * already distinguishes "pending" from "mined" from "not found" from
 * "RPC unavailable" — this module adds swap-specific success/revert
 * interpretation and best-effort realized-amount recovery from logs.
 *
 * A transaction hash existing, or even being mined, is never treated as
 * success on its own — only `receipt.status === "success"` counts.
 */

import { decodeEventLog, getAddress, parseAbiItem, type Address, type TransactionReceipt } from "viem";

import { getTransactionStatus, RobinhoodRpcError } from "@/lib/chain/rpc";
import {
  assertExecutionConfigOnActiveNetwork,
  type RobinhoodExecutionConfig,
} from "@/lib/chain/robinhood-execution-config";

export type SwapReceiptStatus =
  | { status: "pending" }
  | { status: "not_found" }
  | { status: "rpc_unavailable"; detail: string }
  | { status: "reverted"; receipt: TransactionReceipt }
  /** A mined, successful transaction that was NOT sent to the configured
   * UniversalRouter — e.g. an unrelated transfer that happens to share a
   * hash pattern, or a caller passing the wrong hash. This must never be
   * reported as a successful swap. */
  | { status: "unexpected_target"; receipt: TransactionReceipt; actualTarget: Address | null }
  | {
      status: "success";
      receipt: TransactionReceipt;
      /** Best-effort realized amounts recovered from decoded ERC-20
       * Transfer logs — null when they couldn't be recovered (e.g. the
       * swap only involved native ETH transfers, which don't emit an
       * ERC-20 Transfer event, or the log shape wasn't recognized).
       * NEVER the quoted amount — that would defeat the purpose of
       * reading the receipt at all. */
      realizedTokenTransfers: RealizedTransfer[];
    };

export type RealizedTransfer = {
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
};

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

/**
 * Pure interpretation of an already-fetched mined receipt against a
 * specific expected execution config. Takes no RPC action itself — this
 * is the part of `interpretSwapReceipt` that's a pure function of its
 * inputs, split out so it can be exercised directly in deterministic
 * tests with synthetic `TransactionReceipt` fixtures, without touching
 * global RPC state.
 *
 * Never marks a swap successful merely because a receipt exists —
 * `receipt.status` must be `"success"` AND `receipt.to` must equal
 * `config.universalRouter` (EVM-address-safe, checksum-normalized
 * comparison — never a raw case-sensitive string compare). A mined,
 * successful transaction sent somewhere else is reported as
 * `"unexpected_target"`, never as a successful Noah swap.
 *
 * Does NOT require the realized amount to equal the quoted amount —
 * Transfer-log recovery remains best-effort only (see
 * `decodeTransferLogs`).
 */
export function interpretMinedReceipt(
  config: RobinhoodExecutionConfig,
  receipt: TransactionReceipt
): Exclude<SwapReceiptStatus, { status: "pending" | "not_found" | "rpc_unavailable" }> {
  if (receipt.status !== "success") {
    return { status: "reverted", receipt };
  }

  const actualTarget = receipt.to;
  const isExpectedRouter =
    actualTarget !== null && getAddress(actualTarget) === getAddress(config.universalRouter);
  if (!isExpectedRouter) {
    return { status: "unexpected_target", receipt, actualTarget };
  }

  const realizedTokenTransfers = decodeTransferLogs(receipt);
  return { status: "success", receipt, realizedTokenTransfers };
}

/**
 * Interprets a transaction's current on-chain state against a specific,
 * expected execution config. Wraps `lib/chain/rpc.ts#getTransactionStatus`
 * (pending/not_found/rpc_unavailable) and `interpretMinedReceipt`
 * (reverted/unexpected_target/success) into one call.
 *
 * `deps` allows injecting the status-fetching and network-guard
 * functions for deterministic tests — production callers should never
 * pass it; the real implementations are the defaults.
 */
export async function interpretSwapReceipt(
  config: RobinhoodExecutionConfig,
  hash: string,
  deps: {
    fetchStatus?: typeof getTransactionStatus;
    assertNetwork?: typeof assertExecutionConfigOnActiveNetwork;
  } = {}
): Promise<SwapReceiptStatus> {
  const fetchStatus = deps.fetchStatus ?? getTransactionStatus;
  const assertNetwork = deps.assertNetwork ?? assertExecutionConfigOnActiveNetwork;

  try {
    await assertNetwork(config);
  } catch (error) {
    return {
      status: "rpc_unavailable",
      detail: `execution config/network guard failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let statusResult: Awaited<ReturnType<typeof getTransactionStatus>>;
  try {
    statusResult = await fetchStatus(hash);
  } catch (error) {
    if (error instanceof RobinhoodRpcError) {
      if (error.code === "not_found") return { status: "not_found" };
      if (error.code === "invalid_hash") return { status: "not_found" };
      return { status: "rpc_unavailable", detail: error.message };
    }
    return {
      status: "rpc_unavailable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (statusResult.status === "pending") return { status: "pending" };

  return interpretMinedReceipt(config, statusResult.receipt);
}

/**
 * Best-effort ERC-20 `Transfer` log decoding. A log this function can't
 * decode (wrong topic count, malformed data, a non-ERC20-shaped event
 * from an unrelated contract) is silently skipped rather than thrown —
 * this is a "recover what we can" helper, not a strict parser; callers
 * must treat an empty result as "couldn't recover amounts", never as
 * "zero was transferred".
 */
function decodeTransferLogs(receipt: TransactionReceipt): RealizedTransfer[] {
  const transfers: RealizedTransfer[] = [];
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "Transfer") {
        transfers.push({
          token: log.address,
          from: decoded.args.from,
          to: decoded.args.to,
          amount: decoded.args.value,
        });
      }
    } catch {
      // Not a Transfer-shaped log (or from a contract with a
      // differently-shaped event using the same topic0 by coincidence)
      // — skip it, per this function's documented best-effort contract.
    }
  }
  return transfers;
}
