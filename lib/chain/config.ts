/**
 * Centralized Robinhood Chain configuration.
 *
 * This does not replace the existing Solana constants
 * (`lib/perps/program.ts`, `SOLANA_RPC_URL`, etc.) — those stay in place
 * until their Robinhood-Chain replacements have passed verification (see
 * MIGRATION_MATRIX.md / plan PR16). This module is additive: it is the
 * single place new Robinhood-Chain code should read chain id, RPC URL,
 * and explorer links from, instead of re-deriving them per file.
 *
 * Facts below (chain ids, default RPCs, explorer hosts, native symbol)
 * were verified against docs.robinhood.com/chain and Blockscout's own
 * explorer hosts as of 2026-09-28 — see MIGRATION_MATRIX.md.
 */

export type RobinhoodNetwork = "mainnet" | "testnet";

const CHAIN_IDS: Record<RobinhoodNetwork, number> = {
  mainnet: 4663,
  testnet: 46630,
};

/** Robinhood's own public RPCs. Documented as rate-limited and "not for
 * production" — set NEXT_PUBLIC_ROBINHOOD_RPC_URL / ROBINHOOD_RPC_URL to a
 * dedicated provider (Alchemy, QuickNode, Chainstack, Dwellir) for any
 * real traffic. */
const DEFAULT_RPC_URLS: Record<RobinhoodNetwork, string> = {
  mainnet: "https://rpc.mainnet.chain.robinhood.com",
  testnet: "https://rpc.testnet.chain.robinhood.com",
};

const EXPLORER_BASE_URLS: Record<RobinhoodNetwork, string> = {
  mainnet: "https://robinhoodchain.blockscout.com",
  testnet: "https://explorer.testnet.chain.robinhood.com",
};

export const ROBINHOOD_NATIVE_SYMBOL = "ETH" as const;

/** Testnet by default and on purpose, mirroring the existing Perpspad
 * devnet-by-default convention — mainnet is a separate, explicit, later
 * decision gated on the plan's PR10/PR17 verification steps, not a UI
 * toggle. Overriding is an env-var change. */
function resolveNetwork(): RobinhoodNetwork {
  const raw = (
    process.env.NEXT_PUBLIC_ROBINHOOD_NETWORK ?? "testnet"
  ).toLowerCase();
  if (raw === "mainnet") return "mainnet";
  if (raw !== "testnet") {
    console.warn(
      `NEXT_PUBLIC_ROBINHOOD_NETWORK="${raw}" is not "mainnet" or "testnet" — defaulting to testnet.`
    );
  }
  return "testnet";
}

export const ROBINHOOD_NETWORK: RobinhoodNetwork = resolveNetwork();

export const ROBINHOOD_CHAIN_ID: number = CHAIN_IDS[ROBINHOOD_NETWORK];

/** Prefers an explicit dedicated-provider URL; falls back to Robinhood's
 * own public (rate-limited) RPC so local/dev setups work with zero config. */
export const ROBINHOOD_RPC_URL: string =
  process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ??
  process.env.ROBINHOOD_RPC_URL ??
  DEFAULT_RPC_URLS[ROBINHOOD_NETWORK];

export function explorerUrl(kind: "tx" | "address", value: string): string {
  const base = EXPLORER_BASE_URLS[ROBINHOOD_NETWORK];
  const path = kind === "tx" ? "tx" : "address";
  return `${base}/${path}/${value}`;
}

/** All chain ids this app knows about, keyed by network — for code (e.g.
 * wallet network-switch prompts) that needs the non-active network's id
 * too, without hardcoding 4663/46630 again. */
export const ROBINHOOD_CHAIN_IDS = CHAIN_IDS;
