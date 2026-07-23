import { address } from "@solana/kit";

import { getRpc } from "@/lib/solana/wallet";

/**
 * "Alpha wallet" detection is done by polling on-chain token-account state
 * for a user-curated wallet list via the RPC we already have configured
 * (SOLANA_RPC_URL), rather than subscribing to a real-time trade stream.
 * PumpPortal's subscribeAccountTrade/subscribeTokenTrade (the obvious
 * alternative) now require their own API key + a linked wallet funded with
 * >=0.02 SOL, metered per message (confirmed against PumpPortal's docs) —
 * not worth a new paid dependency for this. getTokenAccountsByOwner answers
 * "does wallet X currently hold mint M" directly, for free, on infra this
 * project already pays for.
 */
async function walletHoldsMint(wallet: string, mint: string): Promise<boolean> {
  try {
    const rpc = getRpc();
    const { value } = await rpc
      .getTokenAccountsByOwner(
        address(wallet),
        { mint: address(mint) },
        { encoding: "jsonParsed" }
      )
      .send();
    return value.some((account) => {
      const parsed = account.account.data.parsed;
      return parsed.info.tokenAmount.amount !== "0";
    });
  } catch {
    // Malformed address, RPC error, etc. — treat as "not detected", not
    // as a hard failure of the whole check (other wallets may still hit).
    return false;
  }
}

export type AlphaWalletCheckResult = {
  detected: boolean;
  matchedWallets: string[];
};

/**
 * Checks whether any wallet in `wallets` currently holds `mint`. Empty list
 * is a deliberate no-op (returns not-detected without making any RPC call)
 * — see requireAlphaWalletBuy in lib/sniper/safety-checks.ts for why an
 * empty tracked-wallet list must never behave like "reject everything".
 */
export async function checkAlphaWalletBuy(
  mint: string,
  wallets: string[]
): Promise<AlphaWalletCheckResult> {
  if (wallets.length === 0) return { detected: false, matchedWallets: [] };

  const results = await Promise.all(
    wallets.map(async (wallet) => ({
      wallet,
      holds: await walletHoldsMint(wallet, mint),
    }))
  );
  const matchedWallets = results.filter((r) => r.holds).map((r) => r.wallet);
  return { detected: matchedWallets.length > 0, matchedWallets };
}
