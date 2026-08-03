// Server-only. Reads Perpspad's on-chain state so the database mirrors
// the chain rather than whatever a client claimed.
import { address, createSolanaRpc, type Address } from "@solana/kit";

import { fetchMaybePerpToken } from "@/lib/perps/generated/accounts/perpToken";
import { findPerpTokenPda } from "@/lib/perps/generated/pdas/perpToken";
import { findDriftAuthorityPda } from "@/lib/perps/generated/pdas/driftAuthority";
import { Direction } from "@/lib/perps/generated/types/direction";
import { PERPSPAD_RPC_URL } from "@/lib/perps/program";

/** What the chain says about a launched token. Every field here was read
 * out of the program's own account, never taken from the request body —
 * a caller can pick *which* mint we look at, but not what we believe
 * about it. */
export type OnChainPerpToken = {
  mint: string;
  perpTokenPda: string;
  driftAuthorityPda: string;
  creator: string;
  name: string;
  symbol: string;
  underlyingMarketIndex: number;
  direction: "LONG" | "SHORT";
  targetLeverage: number;
  status: string;
};

const STATUS_BY_INDEX = [
  "pending",
  "active",
  "low_health",
  "liquidated",
  "accumulating",
] as const;

function isPlausibleAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

/**
 * Fetches the `PerpToken` account for `mint`, or null if this program
 * has no such token.
 *
 * Returning null covers three genuinely different situations — the mint
 * doesn't exist, the program isn't deployed on this cluster yet, or the
 * RPC is unreachable — and the caller cannot distinguish them. That's
 * deliberate: all three mean "we have no on-chain evidence for this
 * token", and the one thing that must never happen is recording a token
 * as launched on the strength of a request body alone.
 */
export async function fetchOnChainPerpToken(
  mintStr: string
): Promise<OnChainPerpToken | null> {
  if (!isPlausibleAddress(mintStr)) return null;

  let mint: Address;
  try {
    mint = address(mintStr);
  } catch {
    return null;
  }

  try {
    const rpc = createSolanaRpc(PERPSPAD_RPC_URL);
    const [perpTokenPda] = await findPerpTokenPda({ mint });
    const account = await fetchMaybePerpToken(rpc, perpTokenPda);
    if (!account.exists) return null;

    const data = account.data;
    // The PDA is derived from the mint we were given, and Anchor's
    // discriminator check already ran inside fetchMaybePerpToken, so a
    // mismatch here would mean a genuinely corrupt account rather than a
    // malicious caller — still worth refusing.
    if (data.mint !== mint) return null;

    const [driftAuthorityPda] = await findDriftAuthorityPda({
      perpToken: perpTokenPda,
    });

    return {
      mint: data.mint,
      perpTokenPda,
      driftAuthorityPda,
      creator: data.creator,
      name: data.name,
      symbol: data.symbol,
      underlyingMarketIndex: data.underlyingMarketIndex,
      direction: data.direction === Direction.Long ? "LONG" : "SHORT",
      targetLeverage: data.targetLeverage,
      status: STATUS_BY_INDEX[data.status as number] ?? "pending",
    };
  } catch {
    return null;
  }
}
