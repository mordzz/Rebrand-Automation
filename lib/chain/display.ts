/**
 * Display helpers for trade/position/activity rows.
 *
 * Every row carries its own `chain`; rows render in the chain's native
 * unit (ETH on Robinhood) with Robinhood-explorer tx-hash / token links.
 * Client-safe (no server imports).
 */
import { explorerUrl } from "@/lib/chain/config";

export type ChainRow = {
  chain?: string | null;
  sizeNative?: string | number | null;
  pnlNative?: string | number | null;
};

export function isRobinhoodRow(row: { chain?: string | null }): boolean {
  return row.chain === "robinhood";
}

/** The row's own native symbol when it carries one, else ETH. */
export function nativeSymbolFor(row: object): string {
  return (row as { nativeSymbol?: string | null }).nativeSymbol ?? "ETH";
}

const num = (v: string | number | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The row's position size in its native unit. */
export function rowSize(row: ChainRow): number | null {
  return num(row.sizeNative);
}

/** The row's realized PnL in its native unit. */
export function rowPnl(row: ChainRow): number | null {
  return num(row.pnlNative);
}

export function formatNative(value: number | null, symbol: string, decimals = 3, signed = false): string {
  if (value == null) return "-";
  const sign = signed && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)} ${symbol}`;
}

/** Robinhood explorer transaction link. */
export function txLink(hash: string): string {
  return explorerUrl("tx", hash);
}

/** Robinhood explorer token/contract link. */
export function tokenLink(token: string): string {
  return explorerUrl("address", token);
}

export const EXPLORER_NAME = "Robinhood explorer";
