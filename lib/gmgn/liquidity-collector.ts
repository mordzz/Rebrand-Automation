/**
 * Pure, network-free helpers for the Robinhood `pons new_creation`
 * liquidity longitudinal collector (scripts/collect-robinhood-new-creation-liquidity.ts).
 *
 * Kept separate from the collector script so the dedup/stats/dataset-
 * integrity logic is unit-testable without a live GMGN call or real
 * filesystem — see scripts/test-liquidity-collector.ts.
 *
 * This module does NOT decide any safety/threshold policy. It only
 * normalizes raw GMGN trench items into a stable observation shape,
 * merges them into an accumulated dataset with fail-closed integrity
 * semantics, and computes descriptive statistics.
 */

export type LiquidityObservation = {
  observedAt: string; // ISO timestamp of the most recent sighting
  tokenAddress: string; // normalized lowercase
  createdTimestamp: number; // unix seconds, from GMGN — part of the launch identity
  launchpad: string | null;
  stage: "new_creation";
  liquidityUsd: number | null; // EARLIEST-SIGHTING measurement, immutable once set — see IMMUTABLE_MEASUREMENT_FIELDS
  poolAddress: string | null; // descriptive metadata — may be backfilled
  poolExchange: string | null; // descriptive metadata — may be backfilled
  quoteAddress: string | null; // descriptive metadata — may be backfilled
  quoteSymbol: string | null; // descriptive metadata — may be backfilled
  quoteReserve: number | null; // EARLIEST-SIGHTING measurement, immutable
  quoteUsdPrice: number | null; // EARLIEST-SIGHTING measurement, immutable
  observedQuoteSideEstimate: number | null; // EARLIEST-SIGHTING measurement, immutable (derived from the two above)
  holderCount: number | null; // EARLIEST-SIGHTING measurement, immutable
  marketCap: number | null; // EARLIEST-SIGHTING measurement, immutable
  creatorHoldRate: number | null; // EARLIEST-SIGHTING measurement, immutable
  symbol: string | null; // descriptive metadata — may be backfilled
  name: string | null; // descriptive metadata — may be backfilled
  progress: number | null; // EARLIEST-SIGHTING measurement, immutable
  launchpadStatus: string | null; // EARLIEST-SIGHTING measurement, immutable
  migratedTimestamp: number | null; // EARLIEST-SIGHTING measurement, immutable
  /** When this canonical record was FIRST observed. Never changes once set. */
  firstObservedAt: string;
  timesObserved: number;
};

/**
 * Fields that constitute the canonical launch-liquidity MEASUREMENT.
 * These are the actual statistical data points this dataset exists to
 * collect. They are captured once, at the earliest sighting of a given
 * launch identity, and are NEVER overwritten or backfilled by a later
 * poll — a token seen again 5 minutes later with a newly non-null
 * `liquidityUsd` does not mean the launch-time liquidity was $100; it
 * means liquidity became measurable 5 minutes after launch, which is a
 * different fact than what this dataset records.
 */
export const IMMUTABLE_MEASUREMENT_FIELDS = [
  "liquidityUsd",
  "quoteReserve",
  "quoteUsdPrice",
  "observedQuoteSideEstimate",
  "holderCount",
  "marketCap",
  "creatorHoldRate",
  "progress",
  "launchpadStatus",
  "migratedTimestamp",
] as const satisfies readonly (keyof LiquidityObservation)[];

/**
 * Fields that are just descriptive identity/metadata, not a measurement
 * whose VALUE matters for the statistics. These may be backfilled from
 * a later sighting when previously unknown — doing so cannot change any
 * liquidity/reserve/holder statistic.
 */
const BACKFILLABLE_METADATA_FIELDS = [
  "launchpad",
  "poolAddress",
  "poolExchange",
  "quoteAddress",
  "quoteSymbol",
  "symbol",
  "name",
] as const satisfies readonly (keyof LiquidityObservation)[];

// Dev-time invariant: these two field lists must never overlap — a field
// is either an immutable measurement or backfillable metadata, never both.
const _overlap = BACKFILLABLE_METADATA_FIELDS.filter((f) =>
  (IMMUTABLE_MEASUREMENT_FIELDS as readonly string[]).includes(f)
);
if (_overlap.length > 0) {
  throw new Error(`liquidity-collector: field(s) listed as both immutable and backfillable: ${_overlap.join(", ")}`);
}

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
 * Composite launch identity: `lowercaseTokenAddress:createdTimestamp`,
 * per the original collector requirement. A token address is normally
 * sufficient in practice, but this dataset is meant as durable
 * historical evidence, and GMGN already reports a creation timestamp —
 * using both avoids silently merging two records if an address were
 * ever seen with conflicting launch metadata.
 */
export function observationKey(tokenAddress: string, createdTimestamp: number): string {
  return `${tokenAddress.toLowerCase()}:${createdTimestamp}`;
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
 * dataset. Deduplication key is the composite `observationKey`
 * (normalized-lowercase tokenAddress + createdTimestamp) — see
 * observationKey() above.
 *
 * A token seen again on a later run under the SAME key:
 *   - does NOT create a second statistical sample
 *   - has `timesObserved` incremented and `observedAt` bumped
 *   - has BACKFILLABLE_METADATA_FIELDS filled in if previously null
 *   - NEVER has IMMUTABLE_MEASUREMENT_FIELDS overwritten or backfilled —
 *     the earliest-sighting measurement is the canonical statistical
 *     data point, whether it was null or a real number
 *
 * If the same tokenAddress appears with a DIFFERENT createdTimestamp,
 * its observationKey differs, so it is treated as a distinct launch
 * identity and stored as a separate entry — never silently merged into
 * the prior record for that address.
 */
export function mergeObservations(
  existing: readonly LiquidityObservation[],
  incoming: readonly LiquidityObservation[]
): MergeResult {
  const byKey = new Map<string, LiquidityObservation>();
  for (const obs of existing) byKey.set(observationKey(obs.tokenAddress, obs.createdTimestamp), obs);

  let newCount = 0;
  let updatedCount = 0;
  let alreadyKnownCount = 0;

  for (const incomingObs of incoming) {
    const key = observationKey(incomingObs.tokenAddress, incomingObs.createdTimestamp);
    const prior = byKey.get(key);
    if (!prior) {
      newCount++;
      byKey.set(key, incomingObs);
      continue;
    }

    alreadyKnownCount++;
    let changed = false;
    const backfilled: LiquidityObservation = { ...prior };
    for (const field of BACKFILLABLE_METADATA_FIELDS) {
      if (backfilled[field] == null && incomingObs[field] != null) {
        (backfilled as Record<string, unknown>)[field] = incomingObs[field];
        changed = true;
      }
    }
    // IMMUTABLE_MEASUREMENT_FIELDS are deliberately never touched here.
    backfilled.observedAt = incomingObs.observedAt;
    backfilled.timesObserved = prior.timesObserved + 1;
    if (changed) updatedCount++;
    byKey.set(key, backfilled);
  }

  return {
    merged: [...byKey.values()],
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

// ─────────────────────────────────────────────────────────────────────
// Dataset integrity: parsing/validating persisted JSONL lines.
// Fails closed — a corrupted or schema-invalid line must abort loading
// the whole dataset rather than silently drop that line and let a later
// save rewrite history without it.
// ─────────────────────────────────────────────────────────────────────

export type DatasetLoadResult =
  | { ok: true; observations: LiquidityObservation[] }
  | { ok: false; reason: "parse_error"; lineNumber: number }
  | { ok: false; reason: "invalid_schema"; lineNumber: number; detail: string };

function isValidObservationShape(value: unknown): value is LiquidityObservation {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;

  if (typeof o.tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(o.tokenAddress)) return false;
  if (typeof o.createdTimestamp !== "number" || !Number.isFinite(o.createdTimestamp)) return false;
  if (typeof o.observedAt !== "string" || !o.observedAt) return false;
  if (typeof o.firstObservedAt !== "string" || !o.firstObservedAt) return false;
  if (typeof o.timesObserved !== "number" || !Number.isFinite(o.timesObserved) || o.timesObserved < 1) return false;
  if (o.stage !== "new_creation") return false;

  const nullableNumberFields: (keyof LiquidityObservation)[] = [
    "liquidityUsd",
    "quoteReserve",
    "quoteUsdPrice",
    "observedQuoteSideEstimate",
    "holderCount",
    "marketCap",
    "creatorHoldRate",
    "progress",
    "migratedTimestamp",
  ];
  for (const field of nullableNumberFields) {
    const v = o[field];
    if (v !== null && typeof v !== "number") return false;
  }

  const nullableStringFields: (keyof LiquidityObservation)[] = [
    "launchpad",
    "poolAddress",
    "poolExchange",
    "quoteAddress",
    "quoteSymbol",
    "symbol",
    "name",
    "launchpadStatus",
  ];
  for (const field of nullableStringFields) {
    const v = o[field];
    if (v !== null && typeof v !== "string") return false;
  }

  return true;
}

/**
 * Parses and validates the full contents of a JSONL dataset file. Any
 * unparseable or schema-invalid line aborts the whole load — this
 * function is pure (string in, result out) so it's fixture-testable
 * without touching the real filesystem.
 */
export function parseDataset(fileContents: string): DatasetLoadResult {
  const lines = fileContents.split("\n").filter((l) => l.trim());
  const observations: LiquidityObservation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      return { ok: false, reason: "parse_error", lineNumber };
    }
    if (!isValidObservationShape(parsed)) {
      return { ok: false, reason: "invalid_schema", lineNumber, detail: "observation failed schema validation" };
    }
    observations.push(parsed);
  }

  return { ok: true, observations };
}

export function serializeDataset(observations: readonly LiquidityObservation[]): string {
  return observations.map((o) => JSON.stringify(o)).join("\n") + (observations.length > 0 ? "\n" : "");
}
