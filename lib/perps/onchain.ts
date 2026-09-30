// Server-only. Perpspad on-chain reads — FAIL CLOSED (PR09A).
//
// The Solana/Drift program reader was retired with the Solana runtime.
// Until the Robinhood Lighter migration (PR11–PR13) there is no on-chain
// source to verify a launch against, so this always returns null — which
// the caller already treats as "no on-chain evidence, record nothing".

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

export async function fetchOnChainPerpToken(mintStr: string): Promise<OnChainPerpToken | null> {
  void mintStr;
  return null;
}
