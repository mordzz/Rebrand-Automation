/**
 * Fixture-based tests for lib/gmgn/liquidity-collector.ts - no network
 * calls, no real filesystem, no test framework, following
 * scripts/test-perpspad.ts's convention.
 *
 * Run: tsx scripts/test-liquidity-collector.ts
 */
import {
  normalizeAddress,
  observationKey,
  buildObservationFromRaw,
  mergeObservations,
  quantile,
  computeStats,
  parseDataset,
  serializeDataset,
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

const ADDR_A = "0xAAAA00000000000000000000000000000000AAAA".slice(0, 42);
const ADDR_B = "0xBBBB00000000000000000000000000000000BBBB".slice(0, 42);

// ── address normalization ──
assertEqual(normalizeAddress(ADDR_A), ADDR_A.toLowerCase(), "address normalizes to lowercase");
assertEqual(normalizeAddress("not-an-address"), null, "non-EVM address normalizes to null");
assertEqual(normalizeAddress(undefined), null, "undefined address normalizes to null");

// ── observationKey ──
assertEqual(observationKey(ADDR_A, 1000), observationKey(ADDR_A.toLowerCase(), 1000), "observationKey is case-insensitive on address");
assert(observationKey(ADDR_A, 1000) !== observationKey(ADDR_A, 2000), "observationKey differs for different createdTimestamp");

// ── buildObservationFromRaw ──
{
  const raw = { address: ADDR_A, created_timestamp: 1000, symbol: "FOO", liquidity: 5 };
  const pool = { quote_address: ADDR_B, quote_reserve: 2, liquidity: 5, quote_symbol: "WETH" };
  const obs = buildObservationFromRaw(raw, pool, 100, "2026-09-29T00:00:00.000Z");
  assert(obs !== null, "valid raw item builds an observation");
  assertEqual(obs?.tokenAddress, ADDR_A.toLowerCase(), "tokenAddress normalized");
  assertEqual(obs?.liquidityUsd, 5, "liquidityUsd taken from pool.liquidity");
  assertEqual(obs?.observedQuoteSideEstimate, 400, "observedQuoteSideEstimate = 2 * quoteReserve * quoteUsdPrice");
}

{
  const malformed1 = buildObservationFromRaw({ created_timestamp: 1000 }, null, null, "2026-09-29T00:00:00.000Z");
  assertEqual(malformed1, null, "missing address -> null observation (malformed cannot corrupt dataset)");
  const malformed2 = buildObservationFromRaw({ address: ADDR_A }, null, null, "2026-09-29T00:00:00.000Z");
  assertEqual(malformed2, null, "missing created_timestamp -> null observation");
}

{
  const raw = { address: ADDR_A, created_timestamp: 1000 };
  const obs = buildObservationFromRaw(raw, null, null, "2026-09-29T00:00:00.000Z");
  assertEqual(obs?.liquidityUsd, null, "missing liquidity stays null, never coerced to 0");
  assert(obs?.liquidityUsd !== 0, "null liquidity != zero liquidity");
}

// ── dedup / merge semantics ──
function makeObs(overrides: Partial<LiquidityObservation>): LiquidityObservation {
  return {
    observedAt: "2026-09-29T00:00:00.000Z",
    tokenAddress: ADDR_A.toLowerCase(),
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
  const result = mergeObservations([], [makeObs({})]);
  assertEqual(result.newCount, 1, "new token increases unique launch count");
  assertEqual(result.merged.length, 1, "merged dataset has one entry");
}

{
  // same address + same createdTimestamp -> duplicate
  const existing = [makeObs({})];
  const incoming = [makeObs({ observedAt: "2026-09-29T01:00:00.000Z" })];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.newCount, 0, "same address + same createdTimestamp -> duplicate, not a new launch");
  assertEqual(result.alreadyKnownCount, 1, "repeated token counted as already-known");
  assertEqual(result.merged[0].timesObserved, 2, "timesObserved increments on repeat sighting");
  assertEqual(result.merged[0].firstObservedAt, "2026-09-29T00:00:00.000Z", "earliest observation timestamp preserved");
}

{
  // same address, different casing, same createdTimestamp -> duplicate
  const existing = [makeObs({ tokenAddress: ADDR_A.toLowerCase() })];
  const incoming = [makeObs({ tokenAddress: ADDR_A.toUpperCase().replace("0X", "0x") as string, observedAt: "2026-09-29T01:00:00.000Z" })];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.newCount, 0, "same address different casing + same createdTimestamp -> duplicate");
}

{
  // same address, DIFFERENT createdTimestamp -> NOT silently merged
  const existing = [makeObs({ createdTimestamp: 1000 })];
  const incoming = [makeObs({ createdTimestamp: 2000, observedAt: "2026-09-29T01:00:00.000Z" })];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.newCount, 1, "same address + different createdTimestamp treated as a distinct launch identity");
  assertEqual(result.merged.length, 2, "distinct createdTimestamp is stored as a separate entry, not merged");
}

{
  // first liquidity = null, later liquidity = 100 -> canonical stays null
  const existing = [makeObs({ liquidityUsd: null })];
  const incoming = [makeObs({ observedAt: "2026-09-29T01:00:00.000Z", liquidityUsd: 100 })];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.merged[0].liquidityUsd, null, "first liquidity = null, later liquidity = 100 -> canonical liquidity remains null");
}

{
  // first liquidity = 5, later liquidity = 100 -> canonical stays 5
  const existing = [makeObs({ liquidityUsd: 5 })];
  const incoming = [makeObs({ observedAt: "2026-09-29T01:00:00.000Z", liquidityUsd: 100 })];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.merged[0].liquidityUsd, 5, "first liquidity = 5, later liquidity = 100 -> canonical liquidity remains 5");
}

{
  // dynamic holder/market/progress fields never replaced by later sightings
  const existing = [makeObs({ holderCount: 10, marketCap: 1000, progress: 0.1 })];
  const incoming = [
    makeObs({ observedAt: "2026-09-29T01:00:00.000Z", holderCount: 999, marketCap: 999999, progress: 0.9 }),
  ];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.merged[0].holderCount, 10, "dynamic holderCount not replaced by a later sighting");
  assertEqual(result.merged[0].marketCap, 1000, "dynamic marketCap not replaced by a later sighting");
  assertEqual(result.merged[0].progress, 0.1, "dynamic progress not replaced by a later sighting");
}

{
  // missing static metadata, later metadata becomes known -> approved backfill
  const existing = [makeObs({ symbol: null, poolAddress: null })];
  const incoming = [makeObs({ observedAt: "2026-09-29T01:00:00.000Z", symbol: "FOO", poolAddress: ADDR_B.toLowerCase() })];
  const result = mergeObservations(existing, incoming);
  assertEqual(result.merged[0].symbol, "FOO", "previously-unknown static metadata (symbol) may be backfilled");
  assertEqual(result.merged[0].poolAddress, ADDR_B.toLowerCase(), "previously-unknown static metadata (poolAddress) may be backfilled");
}

{
  const existing = [makeObs({ tokenAddress: ADDR_A.toLowerCase() })];
  const incoming = [makeObs({ tokenAddress: ADDR_B.toLowerCase() })];
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
  const few = Array.from({ length: 5 }, (_, i) =>
    makeObs({ tokenAddress: `0x${i}`.padEnd(42, "0"), liquidityUsd: i })
  );
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

// ── dataset integrity: parseDataset / serializeDataset ──
{
  const good = [makeObs({})];
  const serialized = serializeDataset(good);
  const result = parseDataset(serialized);
  assert(result.ok, "round-tripped valid dataset parses successfully");
  if (result.ok) assertEqual(result.observations.length, 1, "round-tripped dataset has the expected record count");
}

{
  const serialized = `${JSON.stringify(makeObs({}))}\nnot valid json {{{\n`;
  const result = parseDataset(serialized);
  assert(!result.ok, "corrupt JSON line -> dataset loader fails closed");
  if (!result.ok) assertEqual(result.reason, "parse_error", "corrupt line is reported as parse_error");
}

{
  // syntactically valid JSON, but not a valid observation (missing required fields)
  const serialized = `${JSON.stringify({ foo: "bar" })}\n`;
  const result = parseDataset(serialized);
  assert(!result.ok, "syntactically-valid but invalid persisted observation -> dataset loader fails closed");
  if (!result.ok) assertEqual(result.reason, "invalid_schema", "invalid observation is reported as invalid_schema");
}

{
  // a valid record followed by one with a malformed tokenAddress must still fail closed
  const bad = { ...makeObs({}), tokenAddress: "not-an-address" };
  const serialized = `${JSON.stringify(makeObs({}))}\n${JSON.stringify(bad)}\n`;
  const result = parseDataset(serialized);
  assert(!result.ok, "one bad record among valid ones still fails the whole load closed");
}

{
  const result = parseDataset("");
  assert(result.ok, "empty dataset file parses successfully as zero observations");
  if (result.ok) assertEqual(result.observations.length, 0, "empty dataset has zero observations");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
