/**
 * Shared Perpspad program constants. Safe to import from client
 * components — nothing secret lives here.
 *
 * Devnet by default and on purpose: mainnet is a separate, explicit,
 * later decision (see the Perpspad plan). Overriding the cluster is
 * deliberately an env-var change rather than a UI toggle.
 */
import { address, type Address } from "@solana/kit";

export const PERPSPAD_PROGRAM_ID: Address = address(
  process.env.NEXT_PUBLIC_PERPSPAD_PROGRAM_ID ||
    "CUsgyc49DaWgRcRyLfKjrR5SnCRcDi4CAyuBuU692VQa"
);

export const PERPSPAD_RPC_URL: string =
  process.env.NEXT_PUBLIC_PERPSPAD_RPC_URL || "https://api.devnet.solana.com";

/** CAIP-2 chain id, which is what wallet-standard signers (Privy) expect
 * when told where to broadcast. */
export const PERPSPAD_CHAIN = "solana:devnet" as const;

export const PERPSPAD_CLUSTER = "devnet" as const;

/** Explorer link for a signature or address, pinned to the same cluster
 * the program is actually on — a mainnet-defaulting link for a devnet tx
 * silently 404s and looks like the launch failed. */
export function explorerUrl(kind: "tx" | "address", value: string): string {
  return `https://explorer.solana.com/${kind}/${value}?cluster=${PERPSPAD_CLUSTER}`;
}
