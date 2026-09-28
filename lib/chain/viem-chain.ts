/**
 * viem `Chain` definition for the currently-active Robinhood Chain
 * network, built from the centralized constants in `lib/chain/config.ts`
 * rather than re-declaring chain id / RPC / explorer values here.
 * Consumed by Privy's `defaultChain` / `supportedChains`
 * (components/providers.tsx) and, later, by the PR03 RPC/read layer.
 *
 * Only the active network (testnet by default; mainnet only once
 * explicitly enabled via NEXT_PUBLIC_ROBINHOOD_NETWORK, per PR01) is
 * exposed here — the user-wallet layer must not offer a testnet/mainnet
 * switch before the mainnet readiness gate.
 */
import { defineChain, type Chain } from "viem";

import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_BASE_URL,
  ROBINHOOD_NATIVE_SYMBOL,
  ROBINHOOD_NETWORK,
  ROBINHOOD_PUBLIC_RPC_URL,
} from "@/lib/chain/config";

/** The single Robinhood Chain network this deployment is configured for.
 * Client code (Privy's browser-side wallet flows) only ever gets the
 * public RPC — never the server-only ROBINHOOD_RPC_URL, which may carry
 * a provider API key. */
export const robinhoodChain: Chain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: ROBINHOOD_NETWORK === "mainnet" ? "Robinhood Chain" : "Robinhood Chain Testnet",
  nativeCurrency: {
    name: "Ether",
    symbol: ROBINHOOD_NATIVE_SYMBOL,
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [ROBINHOOD_PUBLIC_RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: ROBINHOOD_EXPLORER_BASE_URL,
    },
  },
  testnet: ROBINHOOD_NETWORK === "testnet",
});

/** Privy's `supportedChains` wants an array; this deployment supports
 * exactly one Robinhood Chain network at a time. */
export const robinhoodChains: Chain[] = [robinhoodChain];
