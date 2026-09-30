/**
 * Perpspad program constants.
 *
 * PR09A: the Solana/Drift on-chain Perpspad runtime is retired with the
 * Solana stack. Perps move to Robinhood Chain's Lighter instance in
 * PR11–PR13; until then the on-chain launch/read paths fail closed (see
 * lib/perps/launch.ts and lib/perps/onchain.ts). These constants remain
 * only so historical Perpspad rows keep rendering truthful Solana explorer
 * links.
 */

/** True while perps on-chain actions are unavailable pending the
 * Robinhood Lighter migration (PR11). */
export const PERPS_MIGRATION_MESSAGE =
  "Perps launches are paused while Perpspad migrates from Solana to Robinhood Chain (Lighter).";

export const PERPSPAD_CLUSTER = "devnet" as const;

/** Explorer link for a historical Solana Perpspad signature or address. */
export function explorerUrl(kind: "tx" | "address", value: string): string {
  return `https://explorer.solana.com/${kind}/${value}?cluster=${PERPSPAD_CLUSTER}`;
}
