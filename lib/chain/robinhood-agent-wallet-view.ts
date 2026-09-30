/**
 * Chain-aware agent-wallet response shaping for GET /api/my-bot/wallet —
 * PR09 hardening.
 *
 * Split out as pure functions (given already-fetched balance data, not
 * doing the RPC read itself) so the chain dispatch/response shape can be
 * deterministically tested without a live network. The route handler
 * (app/api/my-bot/wallet/route.ts) does the actual `getNativeBalance`
 * read and passes the result in here.
 *
 * Robinhood responses never reuse the Solana-named fields (`balanceSol`,
 * `sizeSol`, `requiredSol`) — that would put ETH values under names that
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
   * couldn't be read. Never a raw wei bigint — this is a JSON response. */
  balanceNative: string | null;
  /** Always null until a Robinhood funding-sufficiency policy is defined
   * — see this module's doc comment. Never a guessed number. */
  sizeNative: null;
  /** Always null for the same reason as sizeNative. */
  requiredNative: null;
  /** Always null for the same reason — "unknown", never "underfunded". */
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
 * Robinhood network — never silently reads/reports a balance for the
 * wrong network's address space.
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
