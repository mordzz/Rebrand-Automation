"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

import { robinhoodChain, robinhoodChains } from "@/lib/chain/viem-chain";

/** Inlined at build time — when unset, the app renders without Privy and
 * auth surfaces show a setup notice instead of a login button. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/* Kept only for "ethereum-and-solana" continuity — see the walletChainType
 * comment below. Remove once pre-migration Solana-keyed accounts are no
 * longer supported (plan PR16 territory). */
const solanaConnectors = toSolanaWalletConnectors();

export function Providers({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["wallet"],
        appearance: {
          theme: "light",
          accentColor: "#d97757",
          // Robinhood Chain is EVM — the connected wallet establishes
          // ownership only (see components/deploy/deploy-shell.tsx), so
          // any standard EVM wallet (MetaMask, Coinbase Wallet, WalletConnect,
          // etc.) works here. `walletList` is left at Privy's own default.
          //
          // Deliberately "ethereum-and-solana", not "ethereum-only": bots
          // deployed before this migration are keyed by their operator's
          // Solana wallet address (userBots.walletAddress) and reveal-key
          // (components/deploy/reveal-key.tsx) still signs with a Solana
          // wallet via lib/solana/verify-signature.ts. Dropping Solana here
          // would silently orphan every existing bot's login and permanently
          // break key export for them. Narrow to "ethereum-only" only once
          // the wallet-ownership signature scheme has its own EVM migration
          // (see the plan's PR02 wallet-ownership-signature note) and/or a
          // deliberate decision is made about pre-migration accounts.
          walletChainType: "ethereum-and-solana",
        },
        // New embedded wallets default to Robinhood Chain; external
        // wallets are prompted to switch to it if they're elsewhere.
        defaultChain: robinhoodChain,
        supportedChains: robinhoodChains,
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
