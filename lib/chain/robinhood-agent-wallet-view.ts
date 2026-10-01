/**
 * Chain-aware agent-wallet response shaping for GET /api/my-bot/wallet -
 * PR09 hardening.
 *
 * Split out as pure functions (given already-fetched balance data, not
 * doing the RPC read itself) so the chain dispatch/response shape can be
 * deterministically tested without a live network. The route handler
 * (app/api/my-bot/wallet/route.ts) does the actual `getNativeBalance`
 * read and passes the result in here.
 *
 * Robinhood responses never reuse the Solana-named fields (`balanceSol`,
 * `sizeSol`, `requiredSol`) - that would put ETH values under names that
 * mean "SOL" everywhere else in this codebase. This module also never
 * invents a funding-sufficiency threshold for Robinhood: until that
 * policy is defined (a later PR), `sufficient` and `requiredNative` are
 * always `null` here, not a guessed number.
 */
import { formatEther, type Address } from "viem";

import { ROBINHOOD_NATIVE_SYMBOL, ROBINHOOD_NETWORK } from "@/lib/chain/config";

export type RobinhoodAgentWalletView = {
  chain: "robinhood";
  network: string;
  nativeSymbol: string;
  address: Address;
  /** Decimal ETH string (via viem's formatEther), or null if the balance
   * couldn't be read. Never a raw wei bigint - this is a JSON response. */
  balanceNative: string | null;
  /** Always null until a Robinhood funding-sufficiency policy is defined
   * - see this module's doc comment. Never a guessed number. */
  sizeNative: null;
  /** Always null for the same reason as sizeNative. */
  requiredNative: null;
  /** Always null for the same reason - "unknown", never "underfunded". */
  sufficient: null;
  error: string | null;
};

export type NetworkMismatchView = {
  configured: true;
  wallet: null;
  reason: "network_mismatch";
  detail: string;
};

/**
 * Builds the Robinhood-chain wallet view from an already-fetched native
 * balance (or error). Returns a `NetworkMismatchView` instead if the
 * bot's recorded `agentNetwork` doesn't match the process's active
 * Robinhood network - never silently reads/reports a balance for the
 * wrong network's address space.
 *
 * Pure/sync by design - this alone does not prove a caller never
 * performed the balance RPC read before calling it (a caller could fetch
 * the balance first and then discover this returns a mismatch anyway).
 * `loadRobinhoodAgentAccountView` below is the loader that actually
 * enforces the ordering; production code (the API route) should call
 * that, not this function, directly with a live balance.
 */
export function buildRobinhoodAgentWalletView(
  bot: { agentPublicKey: string; agentNetwork: string | null },
  balance: { balanceWei: bigint | null; error: string | null }
): RobinhoodAgentWalletView | NetworkMismatchView {
  if (bot.agentNetwork !== ROBINHOOD_NETWORK) {
    return {
      configured: true,
      wallet: null,
      reason: "network_mismatch",
      detail: `This bot's agent wallet is recorded for network "${bot.agentNetwork}", but the active ` +
        `Robinhood network is "${ROBINHOOD_NETWORK}".`,
    };
  }

  return {
    chain: "robinhood",
    network: ROBINHOOD_NETWORK,
    nativeSymbol: ROBINHOOD_NATIVE_SYMBOL,
    address: bot.agentPublicKey as Address,
    balanceNative: balance.balanceWei !== null ? formatEther(balance.balanceWei) : null,
    sizeNative: null,
    requiredNative: null,
    sufficient: null,
    error: balance.error,
  };
}

/**
 * The chain-aware loader the API route should actually call. Enforces
 * the fail-closed ordering: validate `agentNetwork` FIRST; only call the
 * (injectable) balance dependency if the network actually matches. A
 * mismatched bot never triggers a Robinhood RPC read at all - proven by
 * this function's own deterministic tests via a call-counting spy on
 * `getBalance`, not just by code review.
 */
export async function loadRobinhoodAgentAccountView(
  bot: { agentPublicKey: string; agentNetwork: string | null },
  deps: { getBalance: (address: Address) => Promise<bigint> }
): Promise<RobinhoodAgentWalletView | NetworkMismatchView> {
  if (bot.agentNetwork !== ROBINHOOD_NETWORK) {
    // Network mismatch - return immediately, WITHOUT calling
    // deps.getBalance. buildRobinhoodAgentWalletView also independently
    // checks this (belt-and-suspenders), but the balance dependency is
    // never invoked here in the mismatch branch regardless.
    return buildRobinhoodAgentWalletView(bot, { balanceWei: null, error: null });
  }

  let balanceWei: bigint | null = null;
  let error: string | null = null;
  try {
    balanceWei = await deps.getBalance(bot.agentPublicKey as Address);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not read the wallet balance.";
  }

  return buildRobinhoodAgentWalletView(bot, { balanceWei, error });
}
