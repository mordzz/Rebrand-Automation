/**
 * viem `Chain` definitions for Robinhood Chain, built from the centralized
 * constants in `lib/chain/config.ts` rather than re-declaring chain id /
 * RPC / explorer values here. Consumed by Privy's `defaultChain` /
 * `supportedChains` (components/providers.tsx) and, later, by the PR03
 * RPC/read layer.
 */
import { defineChain, type Chain } from "viem";

import {
  ROBINHOOD_CHAIN_IDS,
  ROBINHOOD_NATIVE_SYMBOL,
  ROBINHOOD_NETWORK,
  ROBINHOOD_PUBLIC_RPC_URL,
} from "@/lib/chain/config";

const explorerBaseUrls: Record<"mainnet" | "testnet", string> = {
  mainnet: "https://robinhoodchain.blockscout.com",
  testnet: "https://explorer.testnet.chain.robinhood.com",
};

function makeChain(network: "mainnet" | "testnet"): Chain {
  // Client code (Privy's browser-side wallet flows) must only ever be
  // handed the public RPC — never the server-only ROBINHOOD_RPC_URL,
  // which may carry a provider API key.
  const rpcUrl = network === ROBINHOOD_NETWORK ? ROBINHOOD_PUBLIC_RPC_URL : undefined;

  return defineChain({
    id: ROBINHOOD_CHAIN_IDS[network],
    name: network === "mainnet" ? "Robinhood Chain" : "Robinhood Chain Testnet",
    nativeCurrency: {
      name: "Ether",
      symbol: ROBINHOOD_NATIVE_SYMBOL,
      decimals: 18,
    },
    rpcUrls: {
      default: { http: rpcUrl ? [rpcUrl] : [] },
    },
    blockExplorers: {
      default: {
        name: "Blockscout",
        url: explorerBaseUrls[network],
      },
    },
    testnet: network === "testnet",
  });
}

/** The network selected via NEXT_PUBLIC_ROBINHOOD_NETWORK — this is what
 * Privy should default new (embedded) wallets to and prompt external
 * wallets to switch to. */
export const robinhoodChain: Chain = makeChain(ROBINHOOD_NETWORK);

/** Both networks, so the app can offer a testnet/mainnet switch later
 * without re-deriving chain definitions. Only the active network's chain
 * gets a real RPC URL wired in above — the other is definition-only. */
export const robinhoodChains: Chain[] = [
  makeChain("mainnet"),
  makeChain("testnet"),
];
