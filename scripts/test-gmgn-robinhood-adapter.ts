/**
 * Focused fixture tests for the GMGN Robinhood discovery adapter
 * (lib/gmgn/discovery-robinhood.ts). No network calls — pure-function
 * tests against normalizeRobinhoodToken() and parseNewCreationPayload(),
 * plus integration-shaped checks of discoverRobinhoodTokens()'s
 * failure-mode distinctions.
 *
 * This repo has no test runner installed (no vitest/jest) — this follows
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
const ALLOWED = ["trench", "pons"];

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    address: A,
    created_timestamp: 1700000000,
    symbol: "TEST",
    launchpad_platform: "trench",
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
    assertEqual(token.creatorAddress, null, "creatorAddress always null (unverified — see file header)");
  }
}

{
  const token = normalizeRobinhoodToken({ address: A, created_timestamp: 1700000000 });
  assert(token !== null, "token with only required fields still normalizes");
  assertEqual(token?.symbol, null, "missing symbol is null, not a crash");
  assertEqual(token?.isHoneypot, null, "missing risk signal is null (unknown), not false");
}

{
  // @ts-expect-error — deliberately wrong shape
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

// ═══ parseNewCreationPayload — the schema-mismatch-vs-empty distinction ═

{
  const outcome = parseNewCreationPayload({ new_creation: [] }, ALLOWED);
  assertEqual(outcome, { ok: true, tokens: [], malformedCount: 0 }, "empty new_creation → successful empty result");
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

// ═══ discoverRobinhoodTokens — configuration/failure distinctions ══════

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
