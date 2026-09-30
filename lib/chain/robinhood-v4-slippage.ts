/**
 * Slippage → minimum-output math — PR08B.
 *
 * Pure, integer-only (`bigint`), no floating point anywhere. Does not
 * read or change Noah's configured slippage value — callers pass
 * whatever `slippageBps` they already resolved from the existing
 * `SniperConfig`/effective-config path; this module only does the
 * arithmetic.
 */

export const MAX_SLIPPAGE_BPS = 10_000; // 100.00%
const BPS_DENOMINATOR = BigInt(10_000);

export type SlippageResult =
  | { ok: true; amountOutMinimum: bigint }
  | { ok: false; reason: string };

/**
 * `amountOutMinimum = amountOutQuoted * (10000 - slippageBps) / 10000`,
 * computed entirely in `bigint` arithmetic (integer division, truncating
 * toward zero — the same direction Solidity's integer division truncates,
 * so this never produces a minimum that's more lenient than what an
 * on-chain check derived the same way would enforce).
 *
 * Fails closed (never returns a value) for:
 *   - `slippageBps` outside `[0, 10000)` — `10000` (100%) would allow a
 *     minimum of zero, which is never acceptable; negative is nonsensical
 *   - a non-integer or negative `amountOutQuoted`
 */
export function computeAmountOutMinimum(
  amountOutQuoted: bigint,
  slippageBps: number
): SlippageResult {
  if (!Number.isInteger(slippageBps)) {
    return { ok: false, reason: `slippageBps must be an integer, got ${slippageBps}` };
  }
  if (slippageBps < 0 || slippageBps >= MAX_SLIPPAGE_BPS) {
    return {
      ok: false,
      reason: `slippageBps must satisfy 0 <= slippageBps < ${MAX_SLIPPAGE_BPS}, got ${slippageBps}`,
    };
  }
  if (amountOutQuoted < BigInt(0)) {
    return { ok: false, reason: `amountOutQuoted must be non-negative, got ${amountOutQuoted}` };
  }

  const bpsBig = BigInt(slippageBps);
  const amountOutMinimum = (amountOutQuoted * (BPS_DENOMINATOR - bpsBig)) / BPS_DENOMINATOR;

  // A non-zero quote must never collapse to a zero minimum — that would
  // mean "any amount out, including dust, is acceptable", which defeats
  // the purpose of a slippage floor. This can only happen with an
  // extremely small quote and non-zero slippage; refusing here is the
  // safe direction (skip the trade) rather than silently accepting a
  // dust-or-nothing minimum.
  if (amountOutQuoted > BigInt(0) && amountOutMinimum === BigInt(0)) {
    return {
      ok: false,
      reason:
        `computed amountOutMinimum rounds to 0 from a non-zero quote (${amountOutQuoted}) ` +
        `at ${slippageBps}bps slippage — refusing rather than allowing an unbounded-downside fill`,
    };
  }

  return { ok: true, amountOutMinimum };
}
