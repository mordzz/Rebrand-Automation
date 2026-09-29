/**
 * Fixture-based tests for lib/gmgn/liquidity-collector.ts — no network
 * calls, no test framework, following scripts/test-perpspad.ts's
 * convention.
 *
 * Run: tsx scripts/test-liquidity-collector.ts
 */
import {
  normalizeAddress,
  buildObservationFromRaw,
  mergeObservations,
  quantile,
  computeStats,
  MIN_UNIQUE_LAUNCHES_FOR_POLICY_REVIEW,
  type LiquidityObservation,
} from "@/lib/gmgn/liquidity-collector";

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string) {
  if (cond) {
    passed++;
    console.log(`[PASS] ${message}`);
  } else {
    failed++;
    console.error(`[FAIL] ${message}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, ok ? message : `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// ── address normalization ──
assertEqual(normalizeAddress("0xABCDEF0123456789ABCDEF0123456789ABCDEF01"), "0xabcdef0123456789abcdef0123456789abcdef01", "address normalizes to lowercase");
assertEqual(normalizeAddress("not-an-address"), null, "non-EVM address normalizes to null");
assertEqual(normalizeAddress(undefined), null, "undefined address normalizes to null");

// ── buildObservationFromRaw ──
{
  const raw = { address: "0xAAAA00000000000000000000000000000000AAAA".slice(0, 42), created_timestamp: 1000, symbol: "FOO", liquidity: 5 };
  const pool = { quote_address: "0xBBBB00000000000000000000000000000000BBBB".slice(0, 42), quote_reserve: 2, liquidity: 5, quote_symbol: "WETH" };
  const obs = buildObservationFromRaw(raw, pool, 100, "2026-09-29T00:00:00.000Z");
  assert(obs !== null, "valid raw item builds an observation");
  assertEqual(obs?.tokenAddress, "0xaaaa00000000000000000000000000000000aaaa", "tokenAddress normalized");
  assertEqual(obs?.liquidityUsd, 5, "liquidityUsd taken from pool.liquidity");
  assertEqual(obs?.observedQuoteSideEstimate, 400, "observedQuoteSideEstimate = 2 * quoteReserve * quoteUsdPrice");
}

{
  const malformed1 = buildObservationFromRaw({ created_timestamp: 1000 }, null, null, "2026-09-29T00:00:00.000Z");
  assertEqual(malformed1, null, "missing address -> null observation (malformed cannot corrupt dataset)");
  const malformed2 = buildObservationFromRaw({ address: "0xAAAA00000000000000000000000000000000AAAA".slice(0, 42) }, null, null, "2026-09-29T00:00:00.000Z");
  assertEqual(malformed2, null, "missing created_timestamp -> null observation");
}

{
  const raw = { address: "0xAAAA00000000000000000000000000000000AAAA".slice(0, 42), created_timestamp: 1000 };
  const obs = buildObservationFromRaw(raw, null, null, "2026-09-29T00:00:00.000Z");
  assertEqual(obs?.liquidityUsd, null, "missing liquidity stays null, never coerced to 0");
  assert(obs?.liquidityUsd !== 0, "null liquidity != zero liquidity");
}

// ── dedup / merge semantics ──
function makeObs(overrides: Partial<LiquidityObservation>): LiquidityObservation {
  return {
    observedAt: "2026-09-29T00:00:00.000Z",
    tokenAddress: "0xaaaa000000000000000000000000000000aaaa",
    createdTimestamp: 1000,
    launchpad: "pons",
    stage: "new_creation",
    liquidityUsd: 5,
    poolAddress: null,
    poolExchange: null,
    quoteAddress: null,
    quoteSymbol: null,
    quoteReserve: null,
    quoteUsdPrice: null,
    observedQuoteSideEstimate: null,
    holderCount: null,
    marketCap: null,
    creatorHoldRate: null,
    symbol: "FOO",
    name: null,
    progress: null,
    launchpadStatus: null,
    migratedTimestamp: null,
    firstObservedAt: "2026-09-29T00:00:00.000Z",
    timesObserved: 1,
    ...overrides,
  };
}

{
  const existing: LiquidityObservation[] = [];
  const incoming = [makeObs({})];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.newCount, 1, "new token increases unique launch count");
  assertEqual(result.merged.length, 1, "merged dataset has one entry");
}

{
  const existing = [makeObs({})];
  const incoming = [makeObs({ observedAt: "2026-09-29T01:00:00.000Z" })];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.newCount, 0, "duplicate polling does not increase unique launch count");
  assertEqual(result.alreadyKnownCount, 1, "repeated token counted as already-known");
  assertEqual(result.merged[0].timesObserved, 2, "timesObserved increments on repeat sighting");
  assertEqual(result.merged[0].firstObservedAt, "2026-09-29T00:00:00.000Z", "earliest observation timestamp preserved");
}

{
  const existing = [makeObs({ holderCount: null })];
  const incoming = [makeObs({ observedAt: "2026-09-29T01:00:00.000Z", holderCount: 42 })];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.merged[0].holderCount, 42, "previously-null field backfilled from a later observation");
}

{
  const existing = [makeObs({ liquidityUsd: 5 })];
  const incoming = [makeObs({ observedAt: "2026-09-29T01:00:00.000Z", liquidityUsd: 999 })];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.merged[0].liquidityUsd, 5, "already-known non-null field is never overwritten (earliest state stays canonical)");
}

{
  const existing = [makeObs({ tokenAddress: "0xaaaa000000000000000000000000000000aaaa" })];
  const incoming = [makeObs({ tokenAddress: "0xbbbb000000000000000000000000000000bbbb" })];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.newCount, 1, "genuinely new token (different address) is counted as new");
  assertEqual(result.merged.length, 2, "total unique launches grows for a genuinely new token");
}

// ── Type-7 quantile ──
assertEqual(quantile([1, 2, 3, 4], 0.5), 2.5, "median of [1,2,3,4] via Type-7 linear interpolation");
assertEqual(quantile([5], 0.9), 5, "single-element quantile returns that element");
assertEqual(quantile([1, 2, 3], 0), 1, "p0 = min");
assertEqual(quantile([1, 2, 3], 1), 3, "p100 = max");

// ── computeStats / status threshold ──
{
  const few = Array.from({ length: 5 }, (_, i) => makeObs({ tokenAddress: `0x${i}`.padEnd(42, "0"), liquidityUsd: i }));
  const stats = computeStats(few);
  assertEqual(stats.status, "DATASET_TOO_SMALL", "fewer than 30 unique launches -> DATASET_TOO_SMALL");
}
{
  const many = Array.from({ length: MIN_UNIQUE_LAUNCHES_FOR_POLICY_REVIEW }, (_, i) =>
    makeObs({ tokenAddress: `0x${i}`.padEnd(42, "0"), liquidityUsd: i })
  );
  const stats = computeStats(many);
  assertEqual(stats.status, "ENOUGH_DATA_FOR_POLICY_REVIEW", "30+ unique launches -> ENOUGH_DATA_FOR_POLICY_REVIEW");
}
{
  const withUnknown = [makeObs({ tokenAddress: "0x1".padEnd(42, "0"), liquidityUsd: null })];
  const stats = computeStats(withUnknown);
  assertEqual(stats.numberWithUsableLiquidity, 0, "null liquidity excluded from usable-liquidity count");
  assertEqual(stats.min, null, "no usable liquidity values -> min is null, not 0");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
