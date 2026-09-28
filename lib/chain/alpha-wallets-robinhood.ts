import { isAddress } from "viem";

import { getErc20Balance } from "@/lib/chain/rpc";

/**
 * EVM/Robinhood-Chain equivalent of lib/sniper/alpha-wallets.ts —
 * "does any configured alpha wallet currently hold this token?", same
 * conceptual behavior, built on the PR03 read layer (`getErc20Balance`)
 * instead of Solana's `getTokenAccountsByOwner`.
 *
 * Deliberately not the GMGN smart-money signal (smartMoneyCount/kolCount
 * on RobinhoodDiscoveredToken) — the alpha-wallet list is Noah's own
 * operator-curated policy, not a provider-supplied signal, same
 * boundary the Solana implementation draws.
 */

/** The balance-read dependency, injectable for tests. Every production
 * caller gets the real PR03 RPC reader by default — this parameter
 * exists purely so tests can prove the positive detection path (a real
 * ERC-20 balance > 0) without a live RPC call, not to give production
 * code a second way to source balances. */
export type Erc20BalanceReader = (tokenAddress: string, wallet: string) => Promise<bigint>;

async function walletHoldsToken(
  wallet: string,
  tokenAddress: string,
  readBalance: Erc20BalanceReader
): Promise<boolean> {
  // Invalid input must never produce a false positive — reject before
  // ever calling the reader, same fail-safe direction as the Solana
  // implementation's catch-and-treat-as-not-detected, but explicit here
  // since an invalid EVM address passed to getErc20Balance would throw
  // (RobinhoodRpcError), not silently misbehave.
  if (!isAddress(wallet) || !isAddress(tokenAddress)) return false;

  try {
    const balance = await readBalance(tokenAddress, wallet);
    return balance > BigInt(0);
  } catch {
    // RPC error, contract that isn't a real ERC-20, etc. — treat as
    // "not detected" for this one wallet, not a hard failure of the
    // whole check (other wallets may still hit). Matches the Solana
    // implementation's posture exactly.
    return false;
  }
}

export type RobinhoodAlphaWalletCheckResult = {
  detected: boolean;
  matchedWallets: string[];
};

/**
 * Checks whether any wallet in `wallets` currently holds `tokenAddress`.
 * Empty list is a deliberate no-op (returns not-detected without making
 * any RPC call) — same contract as checkAlphaWalletBuy: an empty
 * tracked-wallet list must never behave like "reject everything".
 *
 * `readBalance` defaults to the real PR03 `getErc20Balance` — only tests
 * should ever pass a different one.
 */
export async function checkAlphaWalletBuyRobinhood(
  tokenAddress: string,
  wallets: string[],
  readBalance: Erc20BalanceReader = getErc20Balance
): Promise<RobinhoodAlphaWalletCheckResult> {
  if (wallets.length === 0) return { detected: false, matchedWallets: [] };

  const results = await Promise.all(
    wallets.map(async (wallet) => ({
      wallet,
      holds: await walletHoldsToken(wallet, tokenAddress, readBalance),
    }))
  );
  const matchedWallets = results.filter((r) => r.holds).map((r) => r.wallet);
  return { detected: matchedWallets.length > 0, matchedWallets };
}
