/**
 * Lighter (Robinhood Chain perps) configuration - PR11.
 *
 * Source: Lighter's first-party Robinhood-instance docs,
 * https://apidocs.rh.lighter.xyz/docs/get-started (read 2026-10-01), and the
 * live `/info` endpoints (which report the rollup contract below).
 *
 * The Lighter network always follows the active Robinhood network
 * (lib/chain/config.ts) - testnet Noah never talks to mainnet Lighter.
 *
 * NOTE: Lighter's own `chainId` (signing domain for L2 transactions:
 * 466324 mainnet / 300 testnet) is NOT the Robinhood EVM chain id
 * (4663 / 46630). Never substitute one for the other.
 */
import { ROBINHOOD_NETWORK, type RobinhoodNetwork } from "@/lib/chain/config";

export type LighterConfig = {
  network: RobinhoodNetwork;
  /** REST base, including `/api/v1`. */
  apiBaseUrl: string;
  /** Origin for non-versioned endpoints such as `/info`. */
  apiOrigin: string;
  /** Lighter L2 signing chain id (per docs) - not an EVM chain id. */
  lighterChainId: number;
  /** ZkLighter proxy contract on Robinhood Chain (receives margin). */
  rollupContract: `0x${string}`;
};

const CONFIGS: Record<RobinhoodNetwork, LighterConfig> = {
  mainnet: {
    network: "mainnet",
    apiOrigin: "https://api.rh.lighter.xyz",
    apiBaseUrl: "https://api.rh.lighter.xyz/api/v1",
    lighterChainId: 466324,
    rollupContract: "0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d",
  },
  testnet: {
    network: "testnet",
    apiOrigin: "https://api.rh-testnet.lighter.xyz",
    apiBaseUrl: "https://api.rh-testnet.lighter.xyz/api/v1",
    lighterChainId: 300,
    rollupContract: "0x68F3df7B76AfD7851D557cb9706a2e37EDa4BEe3",
  },
};

export function getLighterConfig(network: RobinhoodNetwork = ROBINHOOD_NETWORK): LighterConfig {
  return CONFIGS[network];
}
