"use client";

import { PrivyProvider } from "@privy-io/react-auth";

import { AuthedFetchBridge } from "@/lib/auth/use-privy-authed-fetch";
import { robinhoodChain, robinhoodChains } from "@/lib/chain/viem-chain";

/** Inlined at build time - when unset, the app renders without Privy and
 * auth surfaces show a setup notice instead of a login button. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

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
          // Robinhood Chain is EVM - the connected wallet establishes
          // ownership only (see components/deploy/deploy-shell.tsx), so
          // any standard EVM wallet (MetaMask, Coinbase Wallet, WalletConnect,
          // etc.) works here. `walletList` is left at Privy's own default.
          //
          // EVM-only (PR09A): the Solana runtime - including the Solana
          // reveal-key flow that was the last reason to keep Solana login -
          // is retired. Historical Solana-keyed bots' data stays in the DB.
          walletChainType: "ethereum-only",
        },
        // New embedded wallets default to Robinhood Chain; external
        // wallets are prompted to switch to it if they're elsewhere.
        defaultChain: robinhoodChain,
        supportedChains: robinhoodChains,
      }}
    >
      <AuthedFetchBridge>{children}</AuthedFetchBridge>
    </PrivyProvider>
  );
}
