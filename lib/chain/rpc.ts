/**
 * Server-side Robinhood Chain read layer.
 *
 * Server-only by convention, same as this repo's DB driver modules: never
 * import this from a "use client" component. It reads `ROBINHOOD_RPC_URL`
 * (a server-only env var per lib/chain/config.ts) - that value must never
 * reach the browser bundle, so this file must never be imported from
 * client code. Browser-side chain reads (if ever needed) belong in a
 * separate module built on `ROBINHOOD_PUBLIC_RPC_URL` /
 * `lib/chain/viem-chain.ts` instead.
 *
 * READ ONLY. No signing, no transaction submission, no swaps - those are
 * later migration PRs (see the migration plan). This is the minimum set
 * of primitives later PRs (sniper execution, autonomous wallet, discovery)
 * will build on, so its surface is deliberately small.
 */
import {
  createPublicClient,
  http,
  isAddress,
  isHash,
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

import { ROBINHOOD_CHAIN_ID, ROBINHOOD_RPC_URL } from "@/lib/chain/config";
import { robinhoodChain } from "@/lib/chain/viem-chain";

/** Distinguishes failure kinds callers actually need to branch on, per
 * PR03's requirement not to silently collapse these into a zero balance
 * or a false success. */
export type RobinhoodRpcErrorCode =
  | "rpc_unavailable"
  | "wrong_chain"
  | "invalid_address"
  | "invalid_hash"
  | "not_found";

export class RobinhoodRpcError extends Error {
  readonly code: RobinhoodRpcErrorCode;
  readonly cause?: unknown;

  constructor(code: RobinhoodRpcErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "RobinhoodRpcError";
    this.code = code;
    this.cause = cause;
  }
}

function assertValidAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new RobinhoodRpcError(
      "invalid_address",
      `${label} "${value}" is not a valid EVM address.`
    );
  }
  return value;
}

function assertValidHash(value: string, label: string): Hash {
  if (!isHash(value)) {
    throw new RobinhoodRpcError(
      "invalid_hash",
      `${label} "${value}" is not a valid transaction hash.`
    );
  }
  return value;
}

/** Wraps an RPC call so a network-level failure (DNS, timeout, connection
 * refused, non-JSON-RPC response) surfaces as `rpc_unavailable` with the
 * underlying error attached, rather than an opaque viem/transport error
 * or - worse - a caller-visible zero/empty result. */
async function callRpc<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof RobinhoodRpcError) throw error;
    throw new RobinhoodRpcError(
      "rpc_unavailable",
      `Robinhood Chain RPC call failed: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

let cachedClient: PublicClient | null = null;

/** The shared server-side Robinhood Chain client. Memoized (not created
 * per call) since viem's transport keeps its own connection/cache state;
 * memoizing at module scope is deliberate here (this file is server-only,
 * one process per daemon/request runtime) rather than a global singleton
 * meant to survive across unrelated contexts. */
export function getRobinhoodPublicClient(): PublicClient {
  if (cachedClient) return cachedClient;
  cachedClient = createPublicClient({
    chain: robinhoodChain,
    transport: http(ROBINHOOD_RPC_URL),
  });
  return cachedClient;
}

/**
 * Confirms the configured RPC actually answers for `ROBINHOOD_CHAIN_ID`.
 *
 * Deliberately not run as an import-time side effect - a module-load-time
 * network call would make every import of this file do an RPC round trip
 * (including at build time) and would fail the whole process on a
 * transient network blip rather than the one operation that needed it.
 * Callers (daemon startup, an API route's first RPC use, etc.) should call
 * this explicitly at the point they actually need the guarantee.
 */
export async function assertCorrectChain(
  client: PublicClient = getRobinhoodPublicClient()
): Promise<void> {
  const chainId = await callRpc(() => client.getChainId());
  if (chainId !== ROBINHOOD_CHAIN_ID) {
    throw new RobinhoodRpcError(
      "wrong_chain",
      `Robinhood RPC reported chain id ${chainId}, expected ${ROBINHOOD_CHAIN_ID}. ` +
        `Check ROBINHOOD_RPC_URL / NEXT_PUBLIC_ROBINHOOD_NETWORK.`
    );
  }
}

export async function getLatestBlockNumber(
  client: PublicClient = getRobinhoodPublicClient()
): Promise<bigint> {
  return callRpc(() => client.getBlockNumber());
}

/** Native asset (ETH) balance, in wei. */
export async function getNativeBalance(
  address: string,
  client: PublicClient = getRobinhoodPublicClient()
): Promise<bigint> {
  const account = assertValidAddress(address, "address");
  return callRpc(() => client.getBalance({ address: account }));
}

/**
 * Transaction receipt/status lookup.
 *
 * A missing receipt does not by itself mean "pending" - an unknown or
 * malformed-but-valid-looking hash also has no receipt. So a missing
 * receipt falls through to `getTransaction`: if the transaction itself
 * exists, it's genuinely pending; if it doesn't, that's a `not_found`
 * error, not a pending status. An actual transport/RPC failure at either
 * step propagates as `rpc_unavailable`.
 */
export async function getTransactionStatus(
  hash: string,
  client: PublicClient = getRobinhoodPublicClient()
): Promise<{ status: "pending" } | { status: "mined"; receipt: TransactionReceipt }> {
  const txHash = assertValidHash(hash, "transaction hash");

  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    return { status: "mined", receipt };
  } catch (error) {
    if (!isNotFoundError(error, "TransactionReceiptNotFoundError")) {
      throw new RobinhoodRpcError(
        "rpc_unavailable",
        `Failed to fetch transaction receipt for ${txHash}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error
      );
    }
  }

  // No receipt yet - confirm the transaction actually exists before
  // calling it "pending".
  try {
    await client.getTransaction({ hash: txHash });
    return { status: "pending" };
  } catch (error) {
    if (isNotFoundError(error, "TransactionNotFoundError")) {
      throw new RobinhoodRpcError(
        "not_found",
        `No transaction found for hash ${txHash}.`,
        error
      );
    }
    throw new RobinhoodRpcError(
      "rpc_unavailable",
      `Failed to fetch transaction ${txHash}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error
    );
  }
}

function isNotFoundError(error: unknown, viemErrorName: string): boolean {
  return error instanceof Error && error.name === viemErrorName;
}

/** Minimal ERC-20 read ABI - `balanceOf` only. Intentionally no name/
 * symbol/decimals metadata here: token metadata belongs to the discovery/
 * provider PRs (see the PR05 GMGN field-mapping notes (git history)), not this read layer. */
const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export async function getErc20Balance(
  tokenAddress: string,
  accountAddress: string,
  client: PublicClient = getRobinhoodPublicClient()
): Promise<bigint> {
  const token = assertValidAddress(tokenAddress, "token address");
  const account = assertValidAddress(accountAddress, "account address");
  return callRpc(() =>
    client.readContract({
      address: token,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [account],
    })
  );
}
