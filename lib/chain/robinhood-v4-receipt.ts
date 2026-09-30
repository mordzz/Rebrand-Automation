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

import { decodeEventLog, parseAbiItem, type Address, type TransactionReceipt } from "viem";

import { getTransactionStatus, RobinhoodRpcError } from "@/lib/chain/rpc";

export type SwapReceiptStatus =
  | { status: "pending" }
  | { status: "not_found" }
  | { status: "rpc_unavailable"; detail: string }
  | { status: "reverted"; receipt: TransactionReceipt }
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
 * Interprets a transaction's current on-chain state. Never marks a swap
 * successful merely because a hash was supplied or a receipt exists —
 * `receipt.status` must be `"success"`.
 */
export async function interpretSwapReceipt(hash: string): Promise<SwapReceiptStatus> {
  let statusResult: Awaited<ReturnType<typeof getTransactionStatus>>;
  try {
    statusResult = await getTransactionStatus(hash);
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

  const { receipt } = statusResult;
  if (receipt.status !== "success") {
    return { status: "reverted", receipt };
  }

  const realizedTokenTransfers = decodeTransferLogs(receipt);

  return { status: "success", receipt, realizedTokenTransfers };
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
