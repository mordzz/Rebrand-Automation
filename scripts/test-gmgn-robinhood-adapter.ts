/**
 * Focused fixture tests for the GMGN Robinhood discovery adapter
 * (lib/gmgn/discovery-robinhood.ts). No network calls - pure-function
 * tests against normalizeRobinhoodToken() and parseNewCreationPayload(),
 * plus integration-shaped checks of discoverRobinhoodTokens()'s
 * failure-mode distinctions.
 *
 * This repo has no test runner installed (no vitest/jest) - this follows
 * the existing scripts/test-perpspad.ts convention: a plain tsx script
 * that asserts and exits non-zero on failure.
 *
 * Run: npm run test:gmgn-robinhood
 */
import {
  normalizeRobinhoodToken,
  parseNewCreationPayload,
  discoverRobinhoodTokens,
} from "@/lib/gmgn/discovery-robinhood";

let failures = 0;

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`[FAIL] ${label}\n  expected: ${e}\n  actual:   ${a}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

function assert(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`[FAIL] ${label}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

const A = "0x1111111111111111111111111111111111111111";
const CREATOR = "0x9999999999999999999999999999999999999999";
const ALLOWED = ["trench", "pons"];

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    address: A,
    created_timestamp: 1700000000,
    symbol: "TEST",
    launchpad_platform: "trench",
    creator: CREATOR,
    ...overrides,
  };
}

// ═══ normalizeRobinhoodToken ═══════════════════════════════════════════

{
  const token = normalizeRobinhoodToken(validRaw());
  assert(token !== null, "valid token normalizes to non-null");
  if (token) {
    assertEqual(token.tokenAddress, A, "tokenAddress preserved verbatim");
    assertEqual(token.chain, "robinhood", "chain is robinhood");
    assertEqual(token.creatorAddress, CREATOR, "creatorAddress mapped from live-verified `creator` field");
  }
}

{
  const token = normalizeRobinhoodToken(validRaw({ creator: "not-an-evm-address" }));
  assertEqual(token?.creatorAddress, null, "malformed creator address doesn't reject the token, just nulls the field");
}

// ═══ "yes"/"no"/"unknown" string convention (live-verified: is_honeypot,
//     owner_renounced, open_source, burn_status all use this on Robinhood,
//     not JSON booleans) ═════════════════════════════════════════════════

{
  const token = normalizeRobinhoodToken(validRaw({ is_honeypot: "no" }));
  assertEqual(token?.isHoneypot, false, '"no" string parses to false, not null');
}
{
  const token = normalizeRobinhoodToken(validRaw({ is_honeypot: "unknown" }));
  assertEqual(token?.isHoneypot, null, '"unknown" string parses to null (unknown), not false');
}
{
  const token = normalizeRobinhoodToken(validRaw({ is_honeypot: "yes" }));
  assertEqual(token?.isHoneypot, true, '"yes" string parses to true');
}
{
  // Real booleans (is_wash_trading, has_at_least_one_social) must keep working.
  const token = normalizeRobinhoodToken(validRaw({ is_wash_trading: false }));
  assertEqual(token?.isWashTrading, false, "real JSON boolean false still parses correctly");
}

// ═══ market_cap field priority (live-verified: usd_market_cap never
//     appears on Robinhood; market_cap is the real field) ══════════════

{
  const token = normalizeRobinhoodToken(validRaw({ market_cap: 5131.21 }));
  assertEqual(token?.marketCapUsd, 5131.21, "market_cap alone (no usd_market_cap) maps correctly");
}
{
  // usd_market_cap kept only as a fallback for a hypothetical response
  // shape that uses it - market_cap must win when both are present.
  const token = normalizeRobinhoodToken(validRaw({ market_cap: 100, usd_market_cap: 999 }));
  assertEqual(token?.marketCapUsd, 100, "market_cap takes priority over usd_market_cap");
}

// ═══ buy_tax/sell_tax ratio→percent conversion (live-verified: GMGN
//     reports these as 0–1 ratios, e.g. 0.0899 = 8.99% - buyTaxPct/
//     sellTaxPct must be 0–100 to match every other *Pct field) ════════

{
  const token = normalizeRobinhoodToken(validRaw({ buy_tax: 0.03 }));
  assertEqual(token?.buyTaxPct, 3, "buy_tax: 0.03 ratio converts to buyTaxPct: 3 percent");
}
{
  const token = normalizeRobinhoodToken(validRaw({ sell_tax: 0.0899 }));
  assertEqual(token?.sellTaxPct, 8.99, "sell_tax: 0.0899 ratio converts to sellTaxPct: 8.99 percent");
}
{
  const token = normalizeRobinhoodToken(validRaw({ buy_tax: 0, sell_tax: 0 }));
  assertEqual(token?.buyTaxPct, 0, "zero buy_tax stays zero, not null");
  assertEqual(token?.sellTaxPct, 0, "zero sell_tax stays zero, not null");
}
{
  const token = normalizeRobinhoodToken(validRaw({}));
  assertEqual(token?.buyTaxPct, null, "missing buy_tax stays null");
}
{
  const token = normalizeRobinhoodToken(validRaw({ sell_tax: "not-a-number" }));
  assertEqual(token?.sellTaxPct, null, "invalid sell_tax stays null, doesn't produce NaN or a garbage percent");
}
{
  const token = normalizeRobinhoodToken(validRaw({ buy_tax: -0.01 }));
  assertEqual(token?.buyTaxPct, null, "out-of-range ratio -0.01 → null, not a negative percent");
}
{
  const token = normalizeRobinhoodToken(validRaw({ buy_tax: 1.01 }));
  assertEqual(token?.buyTaxPct, null, "out-of-range ratio 1.01 → null, not a >100% percent");
}
{
  const token = normalizeRobinhoodToken(validRaw({ buy_tax: 1 }));
  assertEqual(token?.buyTaxPct, 100, "boundary ratio 1 → 100 (inclusive upper bound)");
}

// ═══ ratio01: out-of-range safety-critical ratios normalize to null ═══
// (rugRatio, top10HolderRate, bundlerRate, insiderHoldRate - kept as
// 0-1 ratios, not converted to percent, but still range-validated so a
// malformed value like -0.2 can't slip under a `> 0.1` threshold just
// because it's numerically less than the limit)

{
  const token = normalizeRobinhoodToken(validRaw({ rug_ratio: -0.1 }));
  assertEqual(token?.rugRatio, null, "rug_ratio: -0.1 → null (out of range)");
}
{
  const token = normalizeRobinhoodToken(validRaw({ rug_ratio: 1.01 }));
  assertEqual(token?.rugRatio, null, "rug_ratio: 1.01 → null (out of range)");
}
{
  const token = normalizeRobinhoodToken(validRaw({ top_10_holder_rate: -1 }));
  assertEqual(token?.top10HolderRate, null, "top_10_holder_rate: -1 → null (out of range)");
}
{
  const token = normalizeRobinhoodToken(validRaw({ bundler_trader_amount_rate: 1.1 }));
  assertEqual(token?.bundlerRate, null, "bundler_trader_amount_rate: 1.1 → null (out of range)");
}
{
  const token = normalizeRobinhoodToken(validRaw({ suspected_insider_hold_rate: -0.01 }));
  assertEqual(token?.insiderHoldRate, null, "suspected_insider_hold_rate: -0.01 → null (out of range)");
}
{
  const token = normalizeRobinhoodToken(validRaw({ rug_ratio: 0, top_10_holder_rate: 0, bundler_trader_amount_rate: 0, suspected_insider_hold_rate: 0 }));
  assertEqual(token?.rugRatio, 0, "ratio = 0 accepted (rugRatio)");
  assertEqual(token?.top10HolderRate, 0, "ratio = 0 accepted (top10HolderRate)");
  assertEqual(token?.bundlerRate, 0, "ratio = 0 accepted (bundlerRate)");
  assertEqual(token?.insiderHoldRate, 0, "ratio = 0 accepted (insiderHoldRate)");
}
{
  const token = normalizeRobinhoodToken(validRaw({ rug_ratio: 1, top_10_holder_rate: 1, bundler_trader_amount_rate: 1, suspected_insider_hold_rate: 1 }));
  assertEqual(token?.rugRatio, 1, "ratio = 1 accepted (rugRatio)");
  assertEqual(token?.top10HolderRate, 1, "ratio = 1 accepted (top10HolderRate)");
  assertEqual(token?.bundlerRate, 1, "ratio = 1 accepted (bundlerRate)");
  assertEqual(token?.insiderHoldRate, 1, "ratio = 1 accepted (insiderHoldRate)");
}
{
  const token = normalizeRobinhoodToken(validRaw({ creator_balance_rate: -0.5 }));
  assertEqual(token?.creatorHoldRate, null, "creator_balance_rate: -0.5 → null (out of range, ratio01 applied)");
}

{
  const token = normalizeRobinhoodToken({ address: A, created_timestamp: 1700000000 });
  assert(token !== null, "token with only required fields still normalizes");
  assertEqual(token?.symbol, null, "missing symbol is null, not a crash");
  assertEqual(token?.isHoneypot, null, "missing risk signal is null (unknown), not false");
}

{
  // @ts-expect-error - deliberately wrong shape
  assertEqual(normalizeRobinhoodToken(null), null, "null raw item normalizes to null, doesn't throw");
}

assertEqual(
  normalizeRobinhoodToken({ created_timestamp: 1700000000, symbol: "NOADDR" }),
  null,
  "missing address normalizes to null"
);
assertEqual(
  normalizeRobinhoodToken({ address: "7xK4pumpNotAnEvmAddress", created_timestamp: 1700000000 }),
  null,
  "non-EVM address is rejected, not passed through"
);
assertEqual(
  normalizeRobinhoodToken({ address: A, symbol: "NOTS" }),
  null,
  "missing created_timestamp normalizes to null"
);

// ═══ parseNewCreationPayload - the schema-mismatch-vs-empty distinction ═

{
  const outcome = parseNewCreationPayload({ new_creation: [] }, ALLOWED);
  assertEqual(
    outcome,
    { ok: true, tokens: [], malformedCount: 0, totalCount: 0 },
    "empty new_creation → successful empty result"
  );
}

{
  const outcome = parseNewCreationPayload({ new_creation: [validRaw()] }, ALLOWED);
  assert(outcome.ok === true, "non-empty valid payload → ok result");
  if (outcome.ok) {
    assertEqual(outcome.tokens.length, 1, "non-empty valid payload → one valid token");
    assertEqual(outcome.malformedCount, 0, "no malformed items counted for a clean payload");
  }
}

{
  const outcome = parseNewCreationPayload(
    { new_creation: [validRaw({ launchpad_platform: "some_unapproved_platform" })] },
    ALLOWED
  );
  assert(outcome.ok === true, "unsupported launchpad → still a successful (filtered) result");
  if (outcome.ok) {
    assertEqual(outcome.tokens.length, 0, "unsupported launchpad → excluded by the allow-list");
    assertEqual(outcome.malformedCount, 0, "allow-list exclusion is not counted as malformed");
    assertEqual(
      outcome.totalCount,
      1,
      "totalCount still reflects the raw item even though it's neither a token nor malformed " +
        "(this is exactly what malformedCount + tokens.length would have missed - it'd report 0/0)"
    );
  }
}

{
  const outcome = parseNewCreationPayload(
    { new_creation: [validRaw({ launchpad_platform: null })] },
    ALLOWED
  );
  assert(outcome.ok === true, "null launchpad → still a successful (filtered) result");
  if (outcome.ok) assertEqual(outcome.tokens.length, 0, "missing/null launchpad → excluded");
}

{
  const outcome = parseNewCreationPayload(
    { new_creation: [{ symbol: "NOADDR1" }, { created_timestamp: 1700000000 }] },
    ALLOWED
  );
  assertEqual(outcome.ok, false, "non-empty payload where every row is malformed → not ok");
  if (!outcome.ok) assertEqual(outcome.reason, "malformed_payload", "reason is malformed_payload, not empty success");
}

{
  const outcome = parseNewCreationPayload(
    { new_creation: [validRaw(), { symbol: "NOADDR" }] },
    ALLOWED
  );
  assert(outcome.ok === true, "mixed valid + malformed rows → still a successful result");
  if (outcome.ok) {
    assertEqual(outcome.tokens.length, 1, "valid row survives");
    assertEqual(outcome.malformedCount, 1, "malformed row is counted, doesn't corrupt the valid one");
    assertEqual(outcome.totalCount, 2, "totalCount is the real raw item count, not malformedCount + tokens.length");
  }
}

{
  const outcome = parseNewCreationPayload(
    { new_creation: [validRaw({ symbol: "FIRST" }), validRaw({ symbol: "SECOND" })] },
    ALLOWED
  );
  assert(outcome.ok === true, "duplicate-address payload parses successfully");
  if (outcome.ok) {
    assertEqual(outcome.tokens.length, 1, "duplicate token addresses collapse to one token in the parser output");
  }
}

{
  const outcome = parseNewCreationPayload({ new_creation: "not-an-array" }, ALLOWED);
  assertEqual(outcome.ok, false, "non-array new_creation is malformed_payload");
}

{
  const outcome = parseNewCreationPayload({}, ALLOWED);
  assertEqual(outcome.ok, false, "missing new_creation key entirely is malformed_payload");
}

{
  const outcome = parseNewCreationPayload(null, ALLOWED);
  assertEqual(outcome.ok, false, "non-object response body is malformed_payload");
}

// ═══ discoverRobinhoodTokens - configuration/failure distinctions ══════

async function testFailureDistinctions() {
  const originalKey = process.env.GMGN_API_KEY;
  const originalLaunchpads = process.env.GMGN_ROBINHOOD_LAUNCHPADS;
  try {
    // No allow-list supplied and no env var set → fail closed, distinct
    // from "API key missing" and distinct from "no new tokens".
    delete process.env.GMGN_ROBINHOOD_LAUNCHPADS;
    process.env.GMGN_API_KEY = "irrelevant-for-this-check";
    const noAllowlist = await discoverRobinhoodTokens();
    assertEqual(noAllowlist.ok, false, "no launchpad allow-list configured → not ok");
    if (!noAllowlist.ok) {
      assertEqual(
        noAllowlist.reason,
        "launchpad_allowlist_not_configured",
        "reason distinguishes missing allow-list from other failures"
      );
    }

    // Explicit allow-list bypasses the env-var gate but still needs a key.
    delete process.env.GMGN_API_KEY;
    const noKey = await discoverRobinhoodTokens(ALLOWED);
    assertEqual(noKey.ok, false, "unconfigured GMGN_API_KEY (with allow-list supplied) reports a failure");
    if (!noKey.ok) {
      assertEqual(noKey.reason, "not_configured", "reason is not_configured, distinguishable from 'no new tokens'");
    }
  } finally {
    if (originalKey === undefined) delete process.env.GMGN_API_KEY;
    else process.env.GMGN_API_KEY = originalKey;
    if (originalLaunchpads === undefined) delete process.env.GMGN_ROBINHOOD_LAUNCHPADS;
    else process.env.GMGN_ROBINHOOD_LAUNCHPADS = originalLaunchpads;
  }
}

async function main() {
  await testFailureDistinctions();

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
