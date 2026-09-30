/**
 * Lighter integer scaling — PR12.
 *
 * Lighter order fields are integers in market-specific units (per the
 * official lighter-python examples: ETH with size_decimals=4 →
 * `base_amount=1000` is 0.1 ETH; price_decimals=2 → `price=4050_00` is
 * $4050). This module converts decimal STRINGS to those integers with
 * bigint arithmetic only — never JavaScript floating point — and refuses
 * any value that carries more precision than the market supports rather
 * than silently rounding a monetary quantity.
 */

/** Official lighter-go bounds (types/txtypes/constants.go @ v1.0.10). */
export const MAX_ORDER_BASE_AMOUNT = (BigInt(1) << BigInt(48)) - BigInt(1);
export const MIN_ORDER_PRICE = BigInt(1);
export const MAX_ORDER_PRICE = (BigInt(1) << BigInt(32)) - BigInt(1);

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * `"0.1"` with 4 decimals → `1000n`. Throws on negatives, exponents,
 * non-decimal input, or more fractional digits than `decimals` (trailing
 * zeros beyond the precision are allowed).
 */
export function scaleDecimal(value: string, decimals: number, label: string): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(`${label}: invalid market decimals ${decimals}`);
  }
  const m = DECIMAL.exec(value.trim());
  if (!m) throw new Error(`${label}: "${value}" is not a plain non-negative decimal`);
  const whole = m[1];
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > decimals) {
    throw new Error(`${label}: "${value}" has more than ${decimals} decimal places for this market`);
  }
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

/** Inverse of scaleDecimal, for display/logging only. */
export function unscaleInteger(value: bigint, decimals: number): string {
  const neg = value < BigInt(0);
  const s = (neg ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = decimals > 0 ? s.slice(-decimals).replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Leverage → initial margin fraction, as the official SDK computes it
 * (`imf = int(10_000 / leverage)`), integer-only. */
export function leverageToInitialMarginFraction(leverage: number): number {
  if (!Number.isInteger(leverage) || leverage < 1) throw new Error(`leverage must be a positive integer, got ${leverage}`);
  return Math.floor(10_000 / leverage);
}
