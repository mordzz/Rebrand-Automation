// Server-only module.
//
// PR09A: the Solana signing runtime (house wallet from
// PRIVATE_KEY_SOLANA_WALLET, SOL transfers, raw-transaction signing) is
// retired — Robinhood Chain is the active settlement layer. What remains is
// read-only balance lookup for existing Solana addresses, kept so historical
// Solana bots/wallets still display truthfully.
import { assertSolanaAddress, solanaRpc, solanaRpcUrl } from "@/lib/solana/json-rpc";

const LAMPORTS_PER_SOL = 1_000_000_000;

export type WalletSnapshot = {
  connected: boolean;
  address?: string;
  balanceSol?: number;
  balanceUsd?: number;
  solPriceUsd?: number;
  rpc?: string;
  error?: string;
};

async function fetchSolPrice(): Promise<number | undefined> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { next: { revalidate: 60 } }
    );
    const json = await res.json();
    const price = json?.solana?.usd;
    return typeof price === "number" ? price : undefined;
  } catch {
    return undefined;
  }
}

export type AddressBalanceSnapshot = {
  address: string;
  balanceSol?: number;
  balanceUsd?: number;
  rpc?: string;
  error?: string;
};

/** Read-only SOL balance for an existing (historical) Solana address. */
export async function getAddressBalance(addr: string): Promise<AddressBalanceSnapshot> {
  try {
    const [{ value: lamports }, solPriceUsd] = await Promise.all([
      solanaRpc<{ value: number }>("getBalance", [assertSolanaAddress(addr)]),
      fetchSolPrice(),
    ]);
    const balanceSol = Number(lamports) / LAMPORTS_PER_SOL;
    return {
      address: addr,
      balanceSol,
      balanceUsd: solPriceUsd ? balanceSol * solPriceUsd : undefined,
      rpc: new URL(solanaRpcUrl()).host,
    };
  } catch (error) {
    return {
      address: addr,
      error: error instanceof Error ? error.message : "Invalid address or RPC error",
    };
  }
}
