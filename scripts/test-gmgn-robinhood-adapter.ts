/**
 * Focused fixture tests for the GMGN Robinhood discovery adapter
 * (lib/gmgn/discovery-robinhood.ts). No network calls — pure-function
 * tests against normalizeRobinhoodToken() plus one integration-shaped
 * check of discoverRobinhoodTokens()'s error-vs-empty distinction via a
 * temporarily-unset GMGN_API_KEY.
 *
 * This repo has no test runner installed (no vitest/jest) — this follows
 * the existing scripts/test-perpspad.ts convention: a plain tsx script
 * that asserts and exits non-zero on failure.
 *
 * Run: npm run test:gmgn-robinhood
 */
import { normalizeRobinhoodToken, discoverRobinhoodTokens } from "@/lib/gmgn/discovery-robinhood";

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

const VALID_TOKEN_ADDRESS = "0x1234567890123456789012345678901234567890";

// ── 1. Valid Robinhood EVM token address ────────────────────────────────
{
  const raw = {
    address: VALID_TOKEN_ADDRESS,
    symbol: "TEST",
    name: "Test Token",
    created_timestamp: 1700000000,
    launchpad_platform: "trench",
    usd_market_cap: 50000,
    total_supply: 1000000,
    liquidity: 20000,
    holder_count: 42,
    has_at_least_one_social: true,
    twitter: "https://x.com/test",
  };
  const token = normalizeRobinhoodToken(raw, "testnet");
  assert(token !== null, "valid token normalizes to non-null");
  if (token) {
    assertEqual(token.tokenAddress, VALID_TOKEN_ADDRESS, "tokenAddress preserved verbatim");
    assertEqual(token.chain, "robinhood", "chain is robinhood");
    assertEqual(token.network, "testnet", "network passed through");
    assertEqual(token.symbol, "TEST", "symbol mapped");
    assertEqual(token.hasSocialLink, true, "hasSocialLink from has_at_least_one_social");
    assertEqual(token.creatorAddress, null, "creatorAddress always null (unverified — see file header)");
  }
}

// ── 2. Missing optional metadata ────────────────────────────────────────
{
  const raw = {
    address: VALID_TOKEN_ADDRESS,
    created_timestamp: 1700000000,
    // no symbol, name, socials, risk signals at all
  };
  const token = normalizeRobinhoodToken(raw);
  assert(token !== null, "token with only required fields still normalizes");
  if (token) {
    assertEqual(token.symbol, null, "missing symbol is null, not a crash");
    assertEqual(token.hasSocialLink, false, "no socials means hasSocialLink false");
    assertEqual(token.isHoneypot, null, "missing risk signal is null (unknown), not false");
  }
}

// ── 3. Unsupported launchpad — normalization itself doesn't filter by
//      allow-list (that's the caller's job via discoverRobinhoodTokens'
//      request filter), but the launchpad value must still round-trip
//      so a caller CAN filter on it. ──────────────────────────────────
{
  const raw = {
    address: VALID_TOKEN_ADDRESS,
    created_timestamp: 1700000000,
    launchpad_platform: "some_unvetted_platform",
  };
  const token = normalizeRobinhoodToken(raw);
  assertEqual(token?.launchpad, "some_unvetted_platform", "launchpad value preserved for caller-side filtering");
}

// ── 4. Malformed provider payload (not an object) ───────────────────────
{
  // @ts-expect-error — deliberately wrong shape, matches what a
  // malformed API response could hand us before any type-checking.
  const token = normalizeRobinhoodToken(null);
  assertEqual(token, null, "null raw item normalizes to null, doesn't throw");
}

// ── 5. Missing field required by current downstream logic (no address) ──
{
  const raw = { created_timestamp: 1700000000, symbol: "NOADDR" };
  const token = normalizeRobinhoodToken(raw);
  assertEqual(token, null, "missing address normalizes to null");
}

// ── 5b. Non-EVM-shaped address (e.g. a Solana base58 string) is rejected ──
{
  const raw = {
    address: "7xK4pumpXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    created_timestamp: 1700000000,
  };
  const token = normalizeRobinhoodToken(raw);
  assertEqual(token, null, "non-EVM address is rejected, not passed through");
}

// ── 6. Missing creation timestamp ───────────────────────────────────────
{
  const raw = { address: VALID_TOKEN_ADDRESS, symbol: "NOTS" };
  const token = normalizeRobinhoodToken(raw);
  assertEqual(token, null, "missing created_timestamp normalizes to null");
}

// ── 7. "no new tokens" vs "provider/network failure" must not read the
//      same. Verified end-to-end via discoverRobinhoodTokens() with
//      GMGN_API_KEY temporarily unset — the code path that hits an
//      actual malformed_payload/http_error branch requires a live
//      network stub this repo has no framework for, so that branch is
//      covered by lib/gmgn/client.ts's gmgnRequest() typing (exhaustive
//      discriminated union) rather than a runtime call here. ──────────
async function testConfiguredVsEmpty() {
  const originalKey = process.env.GMGN_API_KEY;
  try {
    delete process.env.GMGN_API_KEY;
    const result = await discoverRobinhoodTokens();
    assertEqual(result.ok, false, "unconfigured GMGN_API_KEY reports a failure, not an empty success");
    if (!result.ok) {
      assertEqual(result.reason, "not_configured", "reason is not_configured, distinguishable from 'no new tokens'");
    }
  } finally {
    if (originalKey === undefined) delete process.env.GMGN_API_KEY;
    else process.env.GMGN_API_KEY = originalKey;
  }
}

// ── 8. Duplicate discovery items — dedup happens in discoverRobinhoodTokens,
//      not in normalizeRobinhoodToken (which is a pure 1:1 mapper); this
//      documents that boundary explicitly rather than leaving it implicit. ──
{
  const rawA = { address: VALID_TOKEN_ADDRESS, created_timestamp: 1700000000, symbol: "DUP" };
  const rawB = { address: VALID_TOKEN_ADDRESS, created_timestamp: 1700000001, symbol: "DUP" };
  const a = normalizeRobinhoodToken(rawA);
  const b = normalizeRobinhoodToken(rawB);
  assert(
    a !== null && b !== null && a.tokenAddress === b.tokenAddress,
    "normalizeRobinhoodToken doesn't dedup on its own (by design — caller's job, see discoverRobinhoodTokens)"
  );
}

async function main() {
  await testConfiguredVsEmpty();

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
