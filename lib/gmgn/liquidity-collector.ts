/**
 * Pure, network-free helpers for the Robinhood `pons new_creation`
 * liquidity longitudinal collector (scripts/collect-robinhood-new-creation-liquidity.ts).
 *
 * Kept separate from the collector script so the dedup/stats logic is
 * unit-testable without a live GMGN call — see
 * scripts/test-liquidity-collector.ts.
 *
 * This module does NOT decide any safety/threshold policy. It only
 * normalizes raw GMGN trench items into a stable observation shape and
 * computes descriptive statistics over an accumulated dataset.
 */

export type LiquidityObservation = {
  observedAt: string; // ISO timestamp of this collection run
  tokenAddress: string; // normalized lowercase
  createdTimestamp: number; // unix seconds, from GMGN
  launchpad: string | null;
  stage: "new_creation";
  liquidityUsd: number | null; // null = unknown, never coerced to 0
  poolAddress: string | null;
  poolExchange: string | null;
  quoteAddress: string | null; // normalized lowercase
  quoteSymbol: string | null;
  quoteReserve: number | null;
  quoteUsdPrice: number | null; // null = price lookup failed/unavailable
  observedQuoteSideEstimate: number | null; // 2 * quoteReserve * quoteUsdPrice, empirical only
  holderCount: number | null;
  marketCap: number | null;
  creatorHoldRate: number | null;
  symbol: string | null;
  name: string | null;
  progress: number | null;
  launchpadStatus: string | null;
  migratedTimestamp: number | null;
  /** When this canonical record was first observed (earliest new_creation
   * sighting) vs. this specific poll — used to prove one launch is never
   * double-counted across repeated runs. */
  firstObservedAt: string;
  timesObserved: number;
};

export function normalizeAddress(address: string | null | undefined): string | null {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function numOrNull(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Builds one observation from a raw GMGN `new_creation` trench item plus
 * a resolved quote-token USD price (or null if that lookup failed/was
 * unavailable — never fabricated). Returns null when the item lacks the
 * minimum identity fields (address, created timestamp) — a malformed
 * item must never silently become a fake zero-liquidity record.
 */
export function buildObservationFromRaw(
  raw: Record<string, unknown>,
  pool: Record<string, unknown> | null,
  quoteUsdPrice: number | null,
  observedAt: string
): LiquidityObservation | null {
  const tokenAddress = normalizeAddress(raw.address as string | undefined);
  const createdTimestamp = numOrNull(raw.created_timestamp);
  if (!tokenAddress || createdTimestamp == null) return null;

  const quoteAddress = pool ? normalizeAddress(pool.quote_address as string | undefined) : null;
  const quoteReserve = pool ? numOrNull(pool.quote_reserve) : null;
  const observedQuoteSideEstimate =
    quoteReserve != null && quoteUsdPrice != null ? 2 * quoteReserve * quoteUsdPrice : null;

  return {
    observedAt,
    tokenAddress,
    createdTimestamp,
    launchpad: strOrNull(raw.launchpad_platform) ?? strOrNull(raw.launchpad),
    stage: "new_creation",
    liquidityUsd: numOrNull(pool ? pool.liquidity ?? raw.liquidity : raw.liquidity),
    poolAddress: pool ? normalizeAddress(pool.pool_address as string | undefined) ?? strOrNull(pool.pool_address) : null,
    poolExchange: pool ? strOrNull(pool.exchange) : null,
    quoteAddress,
    quoteSymbol: pool ? strOrNull(pool.quote_symbol) : null,
    quoteReserve,
    quoteUsdPrice,
    observedQuoteSideEstimate,
    holderCount: numOrNull(raw.holder_count),
    marketCap: numOrNull(raw.market_cap) ?? numOrNull(raw.usd_market_cap),
    creatorHoldRate: numOrNull(raw.creator_balance_rate),
    symbol: strOrNull(raw.symbol),
    name: strOrNull(raw.name),
    progress: numOrNull(raw.progress),
    launchpadStatus: strOrNull(raw.launchpad_status),
    migratedTimestamp: numOrNull(raw.migrated_timestamp),
    firstObservedAt: observedAt,
    timesObserved: 1,
  };
}

export type MergeResult = {
  merged: LiquidityObservation[];
  newCount: number;
  updatedCount: number;
  alreadyKnownCount: number;
};

/**
 * Merges freshly-fetched observations into a previously-persisted
 * dataset. Deduplication key is `tokenAddress` alone (a token's
 * `createdTimestamp` is fixed at launch, so tokenAddress is already a
 * stable launch identity within the `new_creation` stage) — case-
 * normalized before comparison.
 *
 * A token seen again on a later run:
 *   - does NOT create a second statistical sample
 *   - has `timesObserved` incremented and `observedAt` bumped
 *   - has any previously-null field backfilled from the new observation,
 *     but fields that were already known are never overwritten (the
 *     EARLIEST observed state is the canonical one for launch-liquidity
 *     analysis)
 */
export function mergeObservations(
  existing: readonly LiquidityObservation[],
  incoming: readonly LiquidityObservation[]
): MergeResult {
  const byAddress = new Map<string, LiquidityObservation>();
  for (const obs of existing) byAddress.set(obs.tokenAddress, obs);

  let newCount = 0;
  let updatedCount = 0;
  let alreadyKnownCount = 0;

  for (const incomingObs of incoming) {
    const prior = byAddress.get(incomingObs.tokenAddress);
    if (!prior) {
      newCount++;
      byAddress.set(incomingObs.tokenAddress, incomingObs);
      continue;
    }

    alreadyKnownCount++;
    let changed = false;
    const backfilled: LiquidityObservation = { ...prior };
    for (const key of Object.keys(incomingObs) as (keyof LiquidityObservation)[]) {
      if (key === "observedAt" || key === "firstObservedAt" || key === "timesObserved") continue;
      if (backfilled[key] == null && incomingObs[key] != null) {
        (backfilled as Record<string, unknown>)[key] = incomingObs[key];
        changed = true;
      }
    }
    backfilled.observedAt = incomingObs.observedAt;
    backfilled.timesObserved = prior.timesObserved + 1;
    if (changed) updatedCount++;
    byAddress.set(incomingObs.tokenAddress, backfilled);
  }

  return {
    merged: [...byAddress.values()],
    newCount,
    updatedCount,
    alreadyKnownCount,
  };
}

/** Standard Type-7 linear-interpolation quantile (index = (n-1) * p). */
export function quantile(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedAsc[0];
  const index = (n - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedAsc[lower];
  const weight = index - lower;
  return sortedAsc[lower] * (1 - weight) + sortedAsc[upper] * weight;
}

export const MIN_UNIQUE_LAUNCHES_FOR_POLICY_REVIEW = 30;

export type LiquidityStats = {
  totalUniqueLaunches: number;
  firstTimestamp: string | null;
  latestTimestamp: string | null;
  numberWithUsableLiquidity: number;
  numberWithZeroLiquidity: number;
  numberWithPositiveLiquidity: number;
  min: number | null;
  p10: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  max: number | null;
  mean: number | null;
  coefficientOfVariation: number | null;
  distinctLiquidityValueCount: number;
  bucketCounts: Record<string, number>;
  pctExactlyZero: number | null;
  pctBelow: Record<string, number>;
  status: "DATASET_TOO_SMALL" | "ENOUGH_DATA_FOR_POLICY_REVIEW";
};

const BUCKETS = [0.01, 0.1, 1, 10, 100, 500, 1000];

export function computeStats(observations: readonly LiquidityObservation[]): LiquidityStats {
  const totalUniqueLaunches = observations.length;
  const timestamps = observations.map((o) => o.firstObservedAt).sort();
  const usable = observations.filter((o) => o.liquidityUsd != null).map((o) => o.liquidityUsd as number);
  const sorted = [...usable].sort((a, b) => a - b);

  const zeroCount = usable.filter((v) => v === 0).length;
  const positiveCount = usable.filter((v) => v > 0).length;

  const mean = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
  let coefficientOfVariation: number | null = null;
  if (mean != null && mean !== 0 && sorted.length > 1) {
    const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (sorted.length - 1);
    coefficientOfVariation = Math.sqrt(variance) / mean;
  }

  const bucketCounts: Record<string, number> = {};
  const pctBelow: Record<string, number> = {};
  for (const threshold of BUCKETS) {
    const label = threshold < 1 ? `<$${threshold.toFixed(2)}` : `<$${threshold}`;
    const count = sorted.filter((v) => v < threshold).length;
    bucketCounts[label] = count;
    pctBelow[label] = sorted.length > 0 ? (count / sorted.length) * 100 : NaN;
  }

  return {
    totalUniqueLaunches,
    firstTimestamp: timestamps[0] ?? null,
    latestTimestamp: timestamps[timestamps.length - 1] ?? null,
    numberWithUsableLiquidity: usable.length,
    numberWithZeroLiquidity: zeroCount,
    numberWithPositiveLiquidity: positiveCount,
    min: sorted.length > 0 ? sorted[0] : null,
    p10: sorted.length > 0 ? quantile(sorted, 0.1) : null,
    p25: sorted.length > 0 ? quantile(sorted, 0.25) : null,
    median: sorted.length > 0 ? quantile(sorted, 0.5) : null,
    p75: sorted.length > 0 ? quantile(sorted, 0.75) : null,
    p90: sorted.length > 0 ? quantile(sorted, 0.9) : null,
    p95: sorted.length > 0 ? quantile(sorted, 0.95) : null,
    max: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    mean,
    coefficientOfVariation,
    distinctLiquidityValueCount: new Set(sorted).size,
    bucketCounts,
    pctExactlyZero: usable.length > 0 ? (zeroCount / usable.length) * 100 : null,
    pctBelow,
    status:
      totalUniqueLaunches >= MIN_UNIQUE_LAUNCHES_FOR_POLICY_REVIEW
        ? "ENOUGH_DATA_FOR_POLICY_REVIEW"
        : "DATASET_TOO_SMALL",
  };
}
