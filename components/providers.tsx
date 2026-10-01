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
          // ownership only (see components/deploy/deploy-shell.tsx).
          // MetaMask is the only offered login wallet.
          walletChainType: "ethereum-only",
          walletList: ["metamask"],
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
