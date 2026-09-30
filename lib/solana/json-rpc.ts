// Server-only, read-only Solana JSON-RPC over plain fetch.
//
// Legacy-read shim (PR09A): the Solana runtime SDK (@solana/kit) was retired
// because it blocked the official Privy server SDK. The few remaining
// read-only lookups kept for historical/legacy data (balances of existing
// Solana addresses, mint/token-account reads behind the untouched GMGN
// Solana safety module) are plain JSON-RPC calls and need no SDK. Nothing
// here signs or submits transactions. PR16 removes this with the rest of
// the residual Solana surface.

const DEFAULT_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export function solanaRpcUrl(overrideUrl?: string | null): string {
  return overrideUrl?.trim() || DEFAULT_RPC_URL;
}

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Shape check only — rejects anything that can't be a Solana address
 * before it's put in an RPC request. */
export function assertSolanaAddress(value: string): string {
  if (!BASE58_ADDRESS.test(value)) {
    throw new Error(`"${value}" is not a Solana address`);
  }
  return value;
}

export async function solanaRpc<T>(
  method: string,
  params: unknown[],
  overrideUrl?: string | null
): Promise<T> {
  const res = await fetch(solanaRpcUrl(overrideUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Solana RPC ${method} failed: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`Solana RPC ${method} error: ${body.error.message ?? "unknown"}`);
  return body.result as T;
}
