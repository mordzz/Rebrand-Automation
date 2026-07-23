import type { Provider } from "@elizaos/core";

import { getWalletSnapshot } from "@/lib/solana/wallet";

/**
 * Live wallet balance in chat context. Hand-rolled on top of the existing
 * getWalletSnapshot() (read-only, no signing) rather than plugin-solana's
 * own wallet provider — see lib/eliza/settings.ts for why that plugin was
 * dropped.
 */
export const walletProvider: Provider = {
  name: "SOLANA_WALLET",
  description: "Live balance of the automation wallet.",
  position: 40,
  // Without this, the context-routing classifier only includes providers
  // whose declared `contexts` match the turn's classified context — a
  // custom provider with no `contexts` defaults to "general" and gets
  // silently dropped on anything classified e.g. "wallet". This is the
  // same flag core's own FACTS/CURRENT_TIME providers use to guarantee
  // presence every turn regardless of classification.
  alwaysInResponseState: true,
  get: async () => {
    const snapshot = await getWalletSnapshot();
    if (!snapshot.connected) {
      return { text: "", values: {}, data: { snapshot } };
    }
    if (typeof snapshot.balanceSol !== "number") {
      return {
        text: `Wallet address ${snapshot.address} is configured, but its live balance could not be read (${snapshot.error ?? "RPC error"}).`,
        values: {},
        data: { snapshot },
      };
    }
    const usd =
      typeof snapshot.balanceUsd === "number"
        ? ` (~$${snapshot.balanceUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })})`
        : "";
    return {
      text: `Automation wallet ${snapshot.address}: ${snapshot.balanceSol.toFixed(2)} SOL${usd}.`,
      values: { balanceSol: snapshot.balanceSol },
      data: { snapshot },
    };
  },
};
