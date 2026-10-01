/**
 * Chain-aware display helpers — PR14 UI identity migration.
 *
 * Every trade/position/activity row carries its own `chain` (PR04). Active
 * Robinhood rows render in ETH with Robinhood-explorer tx-hash / token
 * links; historical Solana rows keep rendering truthfully in SOL with
 * Solana-explorer links. Never relabel one chain's numbers as the other's.
 * Client-safe (no server imports).
 */
import { explorerUrl } from "@/lib/chain/config";

export type ChainRow = {
  chain?: string | null;
  sizeSol?: string | number | null;
  sizeNative?: string | number | null;
  pnlSol?: string | number | null;
  pnlNative?: string | number | null;
};

export function isRobinhoodRow(row: { chain?: string | null }): boolean {
  return row.chain === "robinhood";
}

export function nativeSymbolFor(row: { chain?: string | null }): "ETH" | "SOL" {
  return isRobinhoodRow(row) ? "ETH" : "SOL";
}

const num = (v: string | number | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The row's position size in its own chain's native unit. */
export function rowSize(row: ChainRow): number | null {
  return isRobinhoodRow(row) ? num(row.sizeNative) : num(row.sizeSol);
}

/** The row's realized PnL in its own chain's native unit. */
export function rowPnl(row: ChainRow): number | null {
  return isRobinhoodRow(row) ? num(row.pnlNative) : num(row.pnlSol);
}

export function formatNative(value: number | null, symbol: string, decimals = 3, signed = false): string {
  if (value == null) return "—";
  const sign = signed && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)} ${symbol}`;
}

/** Transaction link: Robinhood explorer tx hash, or Solscan for Solana history. */
export function txLink(row: { chain?: string | null }, hash: string): string {
  return isRobinhoodRow(row) ? explorerUrl("tx", hash) : `https://solscan.io/tx/${hash}`;
}

/** Token link: Robinhood explorer token/contract address, or Solscan mint. */
export function tokenLink(row: { chain?: string | null }, token: string): string {
  return isRobinhoodRow(row) ? explorerUrl("address", token) : `https://solscan.io/token/${token}`;
}

export function explorerName(row: { chain?: string | null }): string {
  return isRobinhoodRow(row) ? "Robinhood explorer" : "Solscan";
}
