import { gmgnRequest } from "./client";

/**
 * Robinhood token price adapter - PR07.
 *
 * Read-only, bounded (inherits gmgnRequest's 8s timeout, same as every
 * other GMGN call in this codebase). Not wired into any signing or
 * execution path - this only produces a number for paper P&L math.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHICH FIELD, AND WHY IT'S TRUSTED
 * ══════════════════════════════════════════════════════════════════════
 * GMGN `/v1/token/info` for `chain=robinhood` returns a `price.price`
 * field - a USD-per-token value. This is NOT a fresh assumption for
 * PR07: it is the exact field the liquidity investigation (PR06.5
 * hardening; see the PR05 GMGN field-mapping notes (git history) and
 * scripts/inspect-robinhood-liquidity.ts /
 * lib/gmgn/liquidity-collector.ts) already live-verified and relied on
 * - there, `/v1/token/info`'s `price.price` for the WETH quote token
 * consistently returned values in the $2710–$2714 range across multiple
 * independent live runs, matching real-world ETH/USD prices at the time
 * (corroborated against a public price reference during that review).
 * That is direct evidence the field is USD-denominated and accurate for
 * at least one real Robinhood-chain token. `/v1/token/info` is a
 * generic per-address endpoint - the same field on the entry token
 * itself (not just the quote token) carries the same contract.
 *
 * This is explicitly NOT `pool.liquidity` (the field investigated and
 * left OBSERVATIONAL-ONLY in lib/gmgn/safety-robinhood.ts) - a
 * different field, used here for a different purpose (a per-token spot
 * price, not a pool-liquidity estimate).
 *
 * Entry and current price both come from this same function/field, so
 * `entryPriceUnit === currentPriceUnit` (both USD-per-token) holds by
 * construction - the invariant PR07 requires for percentage-based exit
 * math to remain meaningful.
 */

export type RobinhoodPriceResult =
  | { ok: true; priceUsd: number }
  | { ok: false; reason: string };

function extractPrice(data: Record<string, unknown>): number | null {
  const priceObj = data.price;
  const raw =
    typeof priceObj === "object" && priceObj !== null
      ? (priceObj as Record<string, unknown>).price
      : undefined;
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  // A literal 0 (or negative) is treated as "no usable price", not a real
  // quote: no live Robinhood pool has a genuine price of zero, so a
  // zero/negative reading means "not priced yet", not "worth nothing".
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Fetches a USD-per-token spot price for one Robinhood token address.
 * Never fabricates a value: any provider failure or an unusable/missing
 * price field returns `ok: false` with a reason, for the caller to skip
 * opening/pricing a position rather than inventing zero or a stale
 * number.
 */
export async function getRobinhoodTokenPriceUsd(
  tokenAddress: string
): Promise<RobinhoodPriceResult> {
  const result = await gmgnRequest<Record<string, unknown>>("/v1/token/info", {
    chain: "robinhood",
    address: tokenAddress,
  });

  if (!result.ok) {
    const reason =
      result.kind === "not_configured"
        ? "GMGN_API_KEY not configured"
        : result.kind === "http_error"
          ? `HTTP ${result.status}`
          : result.kind === "api_error"
            ? `API error code ${result.code}${result.msg ? `: ${result.msg}` : ""}`
            : result.kind === "malformed_payload"
              ? `malformed_payload: ${result.detail}`
              : result.detail;
    return { ok: false, reason };
  }

  if (typeof result.data !== "object" || result.data === null) {
    return { ok: false, reason: `expected an object, got ${typeof result.data}` };
  }

  const priceUsd = extractPrice(result.data);
  if (priceUsd == null) {
    return { ok: false, reason: "no usable price.price field in GMGN token/info response" };
  }

  return { ok: true, priceUsd };
}
