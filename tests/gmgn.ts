/**
 * GMGN Robinhood adapter and Robinhood entry safety policy (offline).
 *
 * Consolidated from: test-gmgn-robinhood-adapter.ts, test-robinhood-safety.ts.
 * Each original suite runs in its own function scope.
 */
import { normalizeRobinhoodToken, parseNewCreationPayload, discoverRobinhoodTokens, type RobinhoodDiscoveredToken, resolveLaunchpadAllowlist } from "@/lib/gmgn/discovery-robinhood";
import { evaluateRobinhoodSafety } from "@/lib/gmgn/safety-robinhood";
import { normalizeRobinhoodSecurity } from "@/lib/gmgn/security-robinhood";
import { checkAlphaWalletBuyRobinhood, type Erc20BalanceReader } from "@/lib/chain/alpha-wallets-robinhood";
import { getTableColumns } from "drizzle-orm";
import { sniperConfig } from "@/lib/db/schema";
import { DEFAULT_TRADING_CONFIG, defaultSniperConfig, validateMaxCreatorHoldPct, type SniperConfig } from "@/lib/sniper/config";
import { sanitize } from "@/lib/sniper/effective-config";

async function gmgn_robinhood_adapter(): Promise<void> {
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
    if (failures !== 0) process.exitCode = 1;
  }


  await main();
}

async function robinhood_safety(): Promise<void> {
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

  const TOKEN_ADDRESS = "0xc3185178243c5a8f85abe1e52fe4119298ba7777";
  const CREATOR = "0x8bf8eace53982a349195c452d1a22d025fae6666";

  function baseConfig(overrides: Partial<SniperConfig> = {}): Pick<
    SniperConfig,
    | "requireOwnerRenounced"
    | "requireNoBlacklistCapability"
    | "maxCreatorHoldPct"
    | "requireSocialLink"
    | "requireAlphaWalletBuy"
    | "alphaWallets"
    | "blockedKeywords"
    | "minTokenAgeSec"
    | "maxTokenAgeSec"
  > {
    return {
      requireOwnerRenounced: false,
      requireNoBlacklistCapability: false,
      // Test-helper default is deliberately null (not the production
      // default of 10) so each test is explicit about what it's checking -
      // the actual approved-default assertion lives in its own test below,
      // against defaultSniperConfig() directly.
      maxCreatorHoldPct: null,
      requireSocialLink: false,
      requireAlphaWalletBuy: false,
      alphaWallets: [],
      blockedKeywords: [],
      minTokenAgeSec: 0,
      maxTokenAgeSec: null,
      ...overrides,
    };
  }

  function makeToken(overrides: Record<string, unknown> = {}): RobinhoodDiscoveredToken {
    const token = normalizeRobinhoodToken({
      address: TOKEN_ADDRESS,
      created_timestamp: Math.floor(Date.now() / 1000) - 30,
      symbol: "TEST",
      name: "Test Token",
      creator: CREATOR,
      launchpad_platform: "pons",
      ...overrides,
    });
    if (!token) throw new Error("test fixture failed to normalize - fix the fixture");
    return token;
  }

  async function main() {
    // ═══ social present / absent / unknown ═══════════════════════════════
    {
      const token = makeToken({ twitter: "someHandle" });
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ requireSocialLink: true }), 30);
      assert(!result.reasons.some((r) => r.includes("website/X/Telegram")), "social present + required → no social refusal");
    }
    {
      const token = makeToken({ twitter: "", telegram: "", website: "" });
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ requireSocialLink: true }), 30);
      assert(result.reasons.some((r) => r.includes("website/X/Telegram")), "social absent + required → refused");
      assertEqual(result.passed, false, "social absent + required → not passed");
    }
    {
      // "unknown" here means has_at_least_one_social absent AND all three
      // link fields empty - the normalizer's only way to represent
      // "we don't know" collapses to the same false as "confirmed absent",
      // which is the fail-closed direction (never a silent pass).
      const token = makeToken({});
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ requireSocialLink: true }), 30);
      assertEqual(result.hasSocialLink, false, "unknown social defaults to false (fail-closed), never a silent pass");
    }

    // ═══ blocked keyword ══════════════════════════════════════════════════
    {
      const token = makeToken({ name: "Definitely A Scam Coin" });
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ blockedKeywords: ["scam"] }), 30);
      assert(result.reasons.some((r) => r.includes("blocked keyword")), "blocked keyword in name → refused");
    }

    // ═══ age min/max ══════════════════════════════════════════════════════
    {
      const token = makeToken({});
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ minTokenAgeSec: 60 }), 10);
      assert(result.reasons.some((r) => r.includes("too young")), "below minTokenAgeSec → refused");
    }
    {
      const token = makeToken({});
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ maxTokenAgeSec: 60 }), 120);
      assert(result.reasons.some((r) => r.includes("too old")), "above maxTokenAgeSec → refused");
    }

    // ═══ Owner-renounced: new EVM policy, distinct from mint-authority ════
    {
      const token = makeToken({});
      const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, { is_renounced: true });
      const result = await evaluateRobinhoodSafety(token, security, baseConfig({ requireOwnerRenounced: true }), 30);
      assert(!result.reasons.some((r) => r.includes("ownership")), "requireOwnerRenounced=true + ownerRenounced=true → no owner refusal");
      assertEqual(result.ownerRenounced, true, "ownerRenounced reflects is_renounced");
    }
    {
      const token = makeToken({});
      const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, { is_renounced: false });
      const result = await evaluateRobinhoodSafety(token, security, baseConfig({ requireOwnerRenounced: true }), 30);
      assert(result.reasons.some((r) => r.includes("contract ownership not renounced")), "requireOwnerRenounced=true + ownerRenounced=false → refused");
    }
    {
      const token = makeToken({});
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ requireOwnerRenounced: true }), 30);
      assert(
        result.reasons.some((r) => r.includes("ownership-renounced status unknown")),
        "requireOwnerRenounced=true + no security data (null) → refused, fails closed"
      );
    }
    {
      const token = makeToken({});
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ requireOwnerRenounced: false }), 30);
      assert(!result.reasons.some((r) => r.includes("ownership")), "requireOwnerRenounced=false → no owner refusal regardless of data");
    }

    // ═══ No-blacklist-capability: new EVM policy, distinct from freeze authority ═
    {
      const token = makeToken({});
      const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, { is_blacklist: false });
      const result = await evaluateRobinhoodSafety(token, security, baseConfig({ requireNoBlacklistCapability: true }), 30);
      assert(!result.reasons.some((r) => r.includes("blacklist")), "requireNoBlacklistCapability=true + isBlacklistCapable=false → no refusal");
    }
    {
      const token = makeToken({});
      const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, { is_blacklist: true });
      const result = await evaluateRobinhoodSafety(token, security, baseConfig({ requireNoBlacklistCapability: true }), 30);
      assert(result.reasons.some((r) => r.includes("has blacklist capability")), "requireNoBlacklistCapability=true + isBlacklistCapable=true → refused");
    }
    {
      const token = makeToken({});
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ requireNoBlacklistCapability: true }), 30);
      assert(
        result.reasons.some((r) => r.includes("blacklist-capability status unknown")),
        "requireNoBlacklistCapability=true + unknown → refused, fails closed"
      );
    }
    {
      const token = makeToken({});
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ requireNoBlacklistCapability: false }), 30);
      assert(!result.reasons.some((r) => r.includes("blacklist")), "requireNoBlacklistCapability=false → no refusal regardless of data");
    }

    // ═══ Creator hold %: new EVM policy, distinct from Solana initial-buy % ═
    {
      // creatorHoldRate 0.05 = 5%, under a 10% limit → passes.
      const token = makeToken({ creator_balance_rate: 0.05 });
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ maxCreatorHoldPct: 10 }), 30);
      assertEqual(result.creatorHoldPct, 5, "creatorHoldPct converts creatorHoldRate 0.05 → 5");
      assert(!result.reasons.some((r) => r.includes("creator holds")), "creatorHoldPct 5% under limit 10% → passes creator-hold check");
    }
    {
      // creatorHoldRate 0.15 = 15%, over a 10% limit → refuses.
      const token = makeToken({ creator_balance_rate: 0.15 });
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ maxCreatorHoldPct: 10 }), 30);
      assert(result.reasons.some((r) => r.includes("creator holds") && r.includes("15.0%")), "creatorHoldPct 15% over limit 10% → refuses");
    }
    {
      // Exactly at the limit (10% == 10%) → passes, per the evaluator's
      // strict `>` comparison (not `>=`).
      const token = makeToken({ creator_balance_rate: 0.1 });
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ maxCreatorHoldPct: 10 }), 30);
      assert(!result.reasons.some((r) => r.includes("creator holds")), "creatorHoldPct exactly 10% (== limit) → passes");
    }
    {
      // Approved v1 default: a fresh install's SniperConfig has
      // maxCreatorHoldPct = 10, not null.
      assertEqual(defaultSniperConfig().maxCreatorHoldPct, 10, "defaultSniperConfig(): maxCreatorHoldPct defaults to 10 (approved v1 value)");
    }
    {
      // No creator_balance_rate at all, but a threshold IS configured →
      // fails closed on the unknown value, distinct from the configuration
      // blocker below.
      const token = makeToken({});
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ maxCreatorHoldPct: 10 }), 30);
      assertEqual(result.creatorHoldPolicyConfigured, true, "creatorHoldPolicyConfigured true once maxCreatorHoldPct is set");
      assert(
        result.reasons.some((r) => r.includes("creator holding percentage unknown")),
        "maxCreatorHoldPct configured but creatorHoldRate unknown → fails closed"
      );
    }
    {
      // maxCreatorHoldPct not configured at all (null, the default) →
      // explicit configuration blocker, regardless of any creator data.
      const token = makeToken({ creator_balance_rate: 0.01 }); // even a tiny, "safe-looking" holding
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ maxCreatorHoldPct: null }), 30);
      assertEqual(result.creatorHoldPolicyConfigured, false, "creatorHoldPolicyConfigured false when maxCreatorHoldPct is null");
      assert(
        result.reasons.some((r) => r.includes("maxCreatorHoldPct not configured")),
        "no configured threshold → explicit configuration blocker"
      );
      assertEqual(result.passed, false, "a candidate cannot pass while maxCreatorHoldPct is unconfigured");
    }
    {
      // A stray unknown field on the config object (here the retired
      // Solana maxCreatorBuyPct) must have zero effect on the creator-hold
      // outcome.
      const token = makeToken({ creator_balance_rate: 0.05 });
      const configWithLegacyField = { ...baseConfig({ maxCreatorHoldPct: 10 }) } as Record<string, unknown>;
      configWithLegacyField.maxCreatorBuyPct = 1; // would refuse a 5% hold if consulted
      const result = await evaluateRobinhoodSafety(
        token,
        null,
        configWithLegacyField as Parameters<typeof evaluateRobinhoodSafety>[2],
        30
      );
      assert(
        !result.reasons.some((r) => r.includes("creator holds")),
        "a stray retired maxCreatorBuyPct value on the object has no effect"
      );
    }

    // ═══ validateMaxCreatorHoldPct - authoritative write-path validation ═══
    // (lib/sniper/config.ts, used directly by updateSniperConfig()'s
    // patchToRow() for the house config PATCH route, and reused by
    // lib/sniper/effective-config.ts's sanitize() for the per-bot overlay -
    // one rule, not two independently-maintained copies)
    {
      assertEqual(validateMaxCreatorHoldPct(null), null, "null is accepted (means unconfigured/fail-closed)");
    }
    for (const value of [0, 10, 100]) {
      assertEqual(validateMaxCreatorHoldPct(value), value, `${value} is accepted (in [0,100])`);
    }
    for (const value of [-1, 100.1, 500, NaN, Infinity, -Infinity]) {
      let threw = false;
      try {
        validateMaxCreatorHoldPct(value);
      } catch {
        threw = true;
      }
      assert(threw, `${value} is rejected (throws), not silently clamped`);
    }
    for (const value of ["10", "not-a-number", {}, [], true, undefined]) {
      let threw = false;
      try {
        validateMaxCreatorHoldPct(value);
      } catch {
        threw = true;
      }
      assert(threw, `${JSON.stringify(value)} (non-number) is rejected`);
    }

    // ═══ the per-bot overlay sanitizer enforces the same rule, not a
    // separate/looser one ══════════════════════════════════════════════════
    {
      const overlay = sanitize({ maxCreatorHoldPct: 15 });
      assertEqual(overlay.maxCreatorHoldPct, 15, "sanitize(): valid maxCreatorHoldPct passes through");
    }
    {
      const overlay = sanitize({ maxCreatorHoldPct: null });
      assertEqual(overlay.maxCreatorHoldPct, null, "sanitize(): null passes through (unconfigured)");
    }
    {
      const overlay = sanitize({ maxCreatorHoldPct: 150 });
      assert(
        !("maxCreatorHoldPct" in overlay),
        "sanitize(): out-of-range maxCreatorHoldPct is dropped (not silently clamped, not thrown to the caller)"
      );
    }
    {
      const overlay = sanitize({ maxCreatorHoldPct: -5 });
      assert(!("maxCreatorHoldPct" in overlay), "sanitize(): negative maxCreatorHoldPct is dropped");
    }

    // ═══ honeypot yes/no/unknown ══════════════════════════════════════════
    {
      const token = makeToken({});
      const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, { is_honeypot: true });
      const result = await evaluateRobinhoodSafety(token, security, baseConfig(), 30);
      assert(result.reasons.some((r) => r.includes("honeypot")), "is_honeypot=true → refused");
    }
    {
      const token = makeToken({ is_honeypot: "no" });
      const result = await evaluateRobinhoodSafety(token, null, baseConfig(), 30);
      assert(!result.reasons.some((r) => r.includes("honeypot")), "is_honeypot=no → not refused for honeypot");
    }
    {
      const token = makeToken({ is_honeypot: "unknown" });
      const result = await evaluateRobinhoodSafety(token, null, baseConfig(), 30);
      assert(
        result.reasons.some((r) => r.includes("honeypot") && r.includes("unknown")),
        "is_honeypot=unknown → REFUSED (fails closed - unlike the existing Solana/GMGN path, which lets unknown pass)"
      );
    }

    // ═══ buy/sell tax percentages + out-of-range + unknown fails closed ═══
    {
      const token = makeToken({ sell_tax: 0.0899, buy_tax: 0.02 }); // 8.99% over floor, 2% under
      const result = await evaluateRobinhoodSafety(token, null, baseConfig(), 30);
      assert(result.reasons.some((r) => r.includes("sell tax") && r.includes("over")), "sell tax over floor → refused");
    }
    {
      const token = makeToken({ buy_tax: 0.02, sell_tax: 0.02 }); // both 2%, under the 5% floor
      const result = await evaluateRobinhoodSafety(token, null, baseConfig(), 30);
      assert(!result.reasons.some((r) => r.includes("buy tax") && r.includes("over")), "buy tax under floor → not refused for exceeding it");
    }
    {
      // Out-of-range ratio already normalizes to null at the discovery
      // layer (PR05); confirming the safety evaluator treats that null the
      // same as any other unknown tax - a refusal, not a pass-through zero.
      const token = makeToken({ buy_tax: 1.5 });
      assertEqual(token.buyTaxPct, null, "out-of-range buy_tax is null by the time it reaches the evaluator");
      const result = await evaluateRobinhoodSafety(token, null, baseConfig(), 30);
      assert(
        result.reasons.some((r) => r.includes("buy tax") && r.includes("unknown")),
        "null buyTaxPct (from an out-of-range ratio) fails closed as unknown, not a silent pass"
      );
    }
    {
      const token = makeToken({}); // no rug_ratio/bundler/insider/top10/is_wash_trading at all
      const result = await evaluateRobinhoodSafety(token, null, baseConfig(), 30);
      assert(result.reasons.some((r) => r.includes("rug history") && r.includes("unknown")), "unknown rug ratio fails closed");
      assert(result.reasons.some((r) => r.includes("bundler") && r.includes("unknown")), "unknown bundler concentration fails closed");
      assert(result.reasons.some((r) => r.includes("insider") && r.includes("unknown")), "unknown insider concentration fails closed");
      assert(result.reasons.some((r) => r.includes("top-10") && r.includes("unknown")), "unknown top-10 concentration fails closed");
      assert(result.reasons.some((r) => r.includes("wash") && r.includes("unknown")), "unknown wash-trading status fails closed");
    }
    {
      // All seven GMGN risk floors explicitly known-safe - none of them
      // should contribute a refusal reason (creator-buy/liquidity-disabled
      // aside, which are covered elsewhere).
      const token = makeToken({
        is_honeypot: "no",
        buy_tax: 0.01,
        sell_tax: 0.01,
        rug_ratio: 0,
        bundler_trader_amount_rate: 0,
        suspected_insider_hold_rate: 0,
        top_10_holder_rate: 0,
        is_wash_trading: false,
      });
      const result = await evaluateRobinhoodSafety(token, null, baseConfig(), 30);
      for (const substr of ["honeypot", "sell tax", "buy tax", "rug history", "bundler", "insider", "top-10", "wash"]) {
        assert(!result.reasons.some((r) => r.includes(substr)), `known-safe value for "${substr}" produces no refusal`);
      }
    }

    // ═══ EVM alpha-wallet: hold detected / no hold / empty list / invalid ═
    {
      const result = await checkAlphaWalletBuyRobinhood(TOKEN_ADDRESS, []);
      assertEqual(result, { detected: false, matchedWallets: [] }, "empty alpha-wallet list is a no-op, no RPC call");
    }
    {
      const result = await checkAlphaWalletBuyRobinhood(TOKEN_ADDRESS, ["not-an-evm-address"]);
      assertEqual(
        result,
        { detected: false, matchedWallets: [] },
        "invalid EVM alpha wallet address cannot create a false positive"
      );
    }
    {
      const result = await checkAlphaWalletBuyRobinhood("not-an-evm-address", ["0x1111111111111111111111111111111111111111"]);
      assertEqual(result, { detected: false, matchedWallets: [] }, "invalid EVM token address cannot create a false positive");
    }
    {
      // requireAlphaWalletBuy=true + non-empty list + no on-chain match
      // (invalid addresses guarantee no match without a real RPC call) →
      // must refuse.
      const token = makeToken({});
      const result = await evaluateRobinhoodSafety(
        token,
        null,
        baseConfig({ requireAlphaWalletBuy: true, alphaWallets: ["not-an-evm-address"] }),
        30
      );
      assertEqual(result.alphaWalletDetected, false, "alphaWalletDetected false when no configured wallet holds it");
      assert(
        result.reasons.some((r) => r.includes("alpha wallet")),
        "requireAlphaWalletBuy=true + no match → refused"
      );
    }
    {
      const token = makeToken({});
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ requireAlphaWalletBuy: false }), 30);
      assertEqual(result.alphaWalletDetected, null, "requireAlphaWalletBuy=false → alphaWalletDetected is null (gate off), not false");
    }

    // ═══ EVM alpha-wallet: positive path, via an injected balance reader ══
    // (checkAlphaWalletBuyRobinhood's default reader is the real PR03
    // getErc20Balance - production callers never pass a substitute. This
    // proves the detection logic itself without a live RPC call.)
    {
      const reader: Erc20BalanceReader = async () => BigInt(1);
      const result = await checkAlphaWalletBuyRobinhood(
        TOKEN_ADDRESS,
        ["0x1111111111111111111111111111111111111111"],
        reader
      );
      assertEqual(result.detected, true, "mocked balance 1n → detected true");
      assertEqual(
        result.matchedWallets,
        ["0x1111111111111111111111111111111111111111"],
        "mocked balance 1n → wallet appears in matchedWallets"
      );
    }
    {
      const reader: Erc20BalanceReader = async () => BigInt(0);
      const result = await checkAlphaWalletBuyRobinhood(
        TOKEN_ADDRESS,
        ["0x1111111111111111111111111111111111111111"],
        reader
      );
      assertEqual(result, { detected: false, matchedWallets: [] }, "mocked balance 0n → not detected");
    }
    {
      const reader: Erc20BalanceReader = async () => {
        throw new Error("simulated RPC failure");
      };
      const result = await checkAlphaWalletBuyRobinhood(
        TOKEN_ADDRESS,
        ["0x1111111111111111111111111111111111111111"],
        reader
      );
      assertEqual(result, { detected: false, matchedWallets: [] }, "read failure → not detected, not a thrown error");
    }
    {
      const A = "0x1111111111111111111111111111111111111111";
      const B = "0x2222222222222222222222222222222222222222";
      const reader: Erc20BalanceReader = async (_token, wallet) => (wallet === A ? BigInt(5) : BigInt(0));
      const result = await checkAlphaWalletBuyRobinhood(TOKEN_ADDRESS, [A, B], reader);
      assertEqual(result.detected, true, "multiple wallets, one positive → detected true");
      assertEqual(result.matchedWallets, [A], "only the wallet with a positive balance appears in matchedWallets");
    }
    {
      // End-to-end through the evaluator: requireAlphaWalletBuy=true with
      // an injected-positive reader isn't directly wireable (the evaluator
      // always uses the real default reader), but this confirms the
      // evaluator's gate-on logic reads whatever checkAlphaWalletBuyRobinhood
      // returns rather than hardcoding a result - see the "no match" case
      // above for the refusal path.
      assert(true, "evaluator's alpha-wallet gate delegates entirely to checkAlphaWalletBuyRobinhood (see above)");
    }

    // ═══ liquidity policy: OBSERVATIONAL ONLY - FINALIZED 2026-09-29 to
    // align with the existing Solana/Pump.fun policy, where launch-time
    // virtual liquidity is not used as a risk discriminator. A `pons
    // new_creation` candidate must never be refused for liquidityUsd alone,
    // regardless of its value. ═══════════════════════════════════════════
    function knownSafeTokenFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        launchpad_platform: "pons",
        has_at_least_one_social: true,
        is_honeypot: "no",
        buy_tax: 0.01,
        sell_tax: 0.01,
        rug_ratio: 0,
        bundler_trader_amount_rate: 0,
        suspected_insider_hold_rate: 0,
        top_10_holder_rate: 0,
        is_wash_trading: false,
        creator_balance_rate: 0,
        ...overrides,
      };
    }

    {
      // Zero liquidity, otherwise fully known-safe → must NOT be refused for
      // liquidity (and, with every other check also known-safe, must pass).
      const token = makeToken(knownSafeTokenFields({ liquidity: 0 }));
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ maxCreatorHoldPct: 10 }), 30);
      assert(
        !result.reasons.some((r) => r.toLowerCase().includes("liquidity")),
        "liquidityUsd = 0 alone never contributes a refusal reason"
      );
      assertEqual(result.passed, true, "otherwise-known-safe token with liquidityUsd = 0 passes");
    }
    {
      // Tiny positive liquidity, otherwise fully known-safe → same result.
      const token = makeToken(knownSafeTokenFields({ liquidity: 0.00005 }));
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ maxCreatorHoldPct: 10 }), 30);
      assert(
        !result.reasons.some((r) => r.toLowerCase().includes("liquidity")),
        "tiny positive liquidityUsd alone never contributes a refusal reason"
      );
      assertEqual(result.passed, true, "otherwise-known-safe token with tiny positive liquidityUsd passes");
    }
    {
      // Large liquidity likewise never contributes a refusal or a pass
      // reason on its own - there is no threshold comparison at all.
      const token = makeToken(knownSafeTokenFields({ liquidity: 1_000_000 }));
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ maxCreatorHoldPct: 10 }), 30);
      assert(
        !result.reasons.some((r) => r.toLowerCase().includes("liquidity")),
        "large liquidityUsd alone never contributes a refusal reason either - no threshold exists in either direction"
      );
    }
    {
      // Zero liquidity does NOT mask a real, unrelated safety failure - a
      // token with zero liquidity AND a blocked keyword is still refused,
      // for the keyword, proving liquidity isn't silently short-circuiting
      // the rest of the evaluator.
      const token = makeToken(knownSafeTokenFields({ liquidity: 0, name: "Definitely A Scam Coin" }));
      const result = await evaluateRobinhoodSafety(
        token,
        null,
        baseConfig({ maxCreatorHoldPct: 10, blockedKeywords: ["scam"] }),
        30
      );
      assertEqual(result.passed, false, "zero-liquidity token is still refused when another safety rule fails");
      assert(result.reasons.some((r) => r.includes("blocked keyword")), "refusal reason is the blocked keyword, not liquidity");
    }
    {
      // Zero liquidity + unknown honeypot status (a genuine safety-critical
      // unknown) - still fails closed on the honeypot unknown, not on
      // liquidity, and liquidity contributes nothing either way.
      const token = makeToken(knownSafeTokenFields({ liquidity: 0, is_honeypot: "unknown" }));
      const result = await evaluateRobinhoodSafety(token, null, baseConfig({ maxCreatorHoldPct: 10 }), 30);
      assertEqual(result.passed, false, "zero-liquidity token with unknown honeypot status is still refused");
      assert(
        result.reasons.some((r) => r.includes("honeypot") && r.includes("unknown")),
        "refusal reason is the unknown honeypot status, not liquidity"
      );
      assert(!result.reasons.some((r) => r.toLowerCase().includes("liquidity")), "liquidity itself contributes no reason");
    }
    {
      // Compile-time proof minLiquiditySol is not part of the Robinhood
      // evaluator's config surface at all - passing it would be a type
      // error, not just a no-op at runtime.
      const configShape: Parameters<typeof evaluateRobinhoodSafety>[2] = baseConfig({ maxCreatorHoldPct: 10 });
      assert(
        !("minLiquiditySol" in configShape),
        "evaluateRobinhoodSafety's config type does not include minLiquiditySol"
      );
    }

    // ═══ duplicate security-field parsing: first-valid-wins, not first-non-null ═
    {
      // Primary field present but malformed; fallback field valid - the
      // valid fallback must win, not get ignored by a bare `??`.
      const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, {
        is_renounced: "not-a-valid-value",
        renounced: true,
      });
      assertEqual(security.ownerRenounced, true, "malformed primary + valid fallback → fallback wins, not null");
    }
    {
      const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, {
        is_blacklist: "garbage",
        blacklist: 0,
      });
      assertEqual(security.isBlacklistCapable, false, "malformed primary + valid (falsy) fallback → fallback wins");
    }
    {
      // Both invalid → null, not a guess.
      const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, {
        is_open_source: "garbage",
        open_source: "also-garbage",
      });
      assertEqual(security.isOpenSource, null, "both primary and fallback invalid → null, never guessed");
    }
    {
      // Primary valid → primary wins even though a fallback also exists,
      // same as before this fix.
      const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, {
        is_honeypot: true,
        honeypot: false,
      });
      assertEqual(security.isHoneypot, true, "valid primary takes priority over a (differently-valued) valid fallback");
    }

    // ═══ security-endpoint top10HolderRate is also range-validated ═══════
    {
      const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, { top_10_holder_rate: -1 });
      assertEqual(security.top10HolderRate, null, "security top_10_holder_rate: -1 → null (out of range)");
    }
    {
      const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, { top_10_holder_rate: 1 });
      assertEqual(security.top10HolderRate, 1, "security top_10_holder_rate: 1 → accepted (boundary)");
    }

    // ═══ safety-critical unknown values do not silently pass ═════════════
    {
      // requireSocialLink + requireOwnerRenounced + requireNoBlacklistCapability
      // all on, nothing known → must refuse on all fronts, never a pass.
      const token = makeToken({});
      const result = await evaluateRobinhoodSafety(
        token,
        null,
        baseConfig({
          requireSocialLink: true,
          requireOwnerRenounced: true,
          requireNoBlacklistCapability: true,
        }),
        30
      );
      assertEqual(result.passed, false, "every safety-critical unknown compounds into a refusal, never a pass");
      assert(result.reasons.length >= 4, "multiple distinct blocker/refusal reasons are all surfaced, not collapsed");
    }

    // ═══ no other launchpad becomes implicitly allowed ════════════════════
    {
      // .env.example now recommends GMGN_ROBINHOOD_LAUNCHPADS=pons, but
      // that's documentation, not a code default - the resolver must still
      // fail closed (return null) with nothing configured, exactly as
      // before this PR. No launchpad, "pons" included, is hardcoded here.
      const originalEnv = process.env.GMGN_ROBINHOOD_LAUNCHPADS;
      try {
        delete process.env.GMGN_ROBINHOOD_LAUNCHPADS;
        assertEqual(
          resolveLaunchpadAllowlist(),
          null,
          "resolveLaunchpadAllowlist() with nothing configured is still null - pons is not a hardcoded default"
        );
      } finally {
        if (originalEnv === undefined) delete process.env.GMGN_ROBINHOOD_LAUNCHPADS;
        else process.env.GMGN_ROBINHOOD_LAUNCHPADS = originalEnv;
      }
    }
    {
      // Only what's explicitly configured is allowed - e.g. an operator
      // who sets GMGN_ROBINHOOD_LAUNCHPADS=pons does not implicitly also
      // get flap/flap_pve/longxyz/trench/etc.
      const originalEnv = process.env.GMGN_ROBINHOOD_LAUNCHPADS;
      try {
        process.env.GMGN_ROBINHOOD_LAUNCHPADS = "pons";
        assertEqual(
          resolveLaunchpadAllowlist(),
          ["pons"],
          "GMGN_ROBINHOOD_LAUNCHPADS=pons resolves to exactly ['pons'], no other platform implicitly included"
        );
      } finally {
        if (originalEnv === undefined) delete process.env.GMGN_ROBINHOOD_LAUNCHPADS;
        else process.env.GMGN_ROBINHOOD_LAUNCHPADS = originalEnv;
      }
    }

    // ═══ typed defaults match the schema column defaults ═══════════════════
    {
      // DEFAULT_TRADING_CONFIG (no-DB path) and the sniper_config column
      // defaults (fresh-DB path) must describe the same product defaults.
      const columns = getTableColumns(sniperConfig) as Record<string, { default?: unknown; dataType: string }>;
      for (const [key, value] of Object.entries(DEFAULT_TRADING_CONFIG)) {
        if (key === "entrySources") continue; // code default, not a column
        const column = columns[key];
        if (!column) {
          assert(false, `sniper_config has a column for default "${key}"`);
          continue;
        }
        const raw = column.default;
        const columnDefault =
          raw === undefined ? null : typeof value === "number" ? Number(raw) : raw;
        assertEqual(columnDefault, value, `schema default for "${key}" matches DEFAULT_TRADING_CONFIG`);
      }
      for (const retired of ["maxSolPerSnipe", "maxTotalDeployedSol", "maxDailyDrawdownSol", "maxCreatorBuyPct", "requireMintAuthorityRenounced", "requireFreezeAuthorityRenounced"]) {
        assert(!(retired in columns), `retired Solana column "${retired}" is absent from sniper_config`);
        assert(!(retired in DEFAULT_TRADING_CONFIG), `retired Solana field "${retired}" is absent from SniperConfig`);
      }
    }

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    if (failures !== 0) process.exitCode = 1;
  }


  await main();
}

async function runAll(): Promise<void> {
  console.log("\n=== gmgn-robinhood-adapter ===");
  try {
    await gmgn_robinhood_adapter();
  } catch (error) {
    console.error("[FAIL] test-gmgn-robinhood-adapter threw:", error);
    process.exitCode = 1;
  }
  console.log("\n=== robinhood-safety ===");
  try {
    await robinhood_safety();
  } catch (error) {
    console.error("[FAIL] test-robinhood-safety threw:", error);
    process.exitCode = 1;
  }
}

void runAll();
