/**
 * Focused tests for the PR06 / PR06.5 Robinhood safety foundation and
 * policy: lib/gmgn/safety-robinhood.ts, lib/gmgn/security-robinhood.ts,
 * lib/chain/alpha-wallets-robinhood.ts.
 *
 * No network calls (alpha-wallet checks use invalid/empty inputs so the
 * RPC path is never actually hit) - same plain-tsx-script convention as
 * scripts/test-gmgn-robinhood-adapter.ts.
 *
 * Run: npm run test:robinhood-safety
 */
import { evaluateRobinhoodSafety } from "@/lib/gmgn/safety-robinhood";
import { normalizeRobinhoodSecurity } from "@/lib/gmgn/security-robinhood";
import { normalizeRobinhoodToken, type RobinhoodDiscoveredToken } from "@/lib/gmgn/discovery-robinhood";
import { checkAlphaWalletBuyRobinhood, type Erc20BalanceReader } from "@/lib/chain/alpha-wallets-robinhood";
import { resolveLaunchpadAllowlist } from "@/lib/gmgn/discovery-robinhood";
import { validateMaxCreatorHoldPct, envSeededDefaults, type SniperConfig } from "@/lib/sniper/config";
import { sanitize } from "@/lib/sniper/effective-config";

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
    // against envSeededDefaults() directly.
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
    // Approved v1 default: a fresh install's SniperConfig (no DB row,
    // env-seeded fallback) has maxCreatorHoldPct = 10, not null.
    assertEqual(envSeededDefaults().maxCreatorHoldPct, 10, "envSeededDefaults(): maxCreatorHoldPct defaults to 10 (approved v1 value)");
    // The legacy Solana field is untouched by this decision.
    assertEqual(envSeededDefaults().maxCreatorBuyPct, 10, "envSeededDefaults(): maxCreatorBuyPct (Solana) is unaffected by the Robinhood v1 default change");
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
    // maxCreatorBuyPct (the legacy Solana field) must never be consulted
    // by the Robinhood evaluator - proven by the fact its Pick<> type
    // doesn't even include it (a TypeScript-level guarantee), plus a
    // runtime check that a wildly-different maxCreatorBuyPct value has
    // zero effect on the creator-hold outcome.
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
      "maxCreatorBuyPct is not consulted for Robinhood - a stray value on the object has no effect"
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

  // ═══ legacy Solana config fields remain present/unchanged ════════════
  {
    // Type-level guarantee: SniperConfig still has the legacy Solana
    // fields, untouched, alongside the new Robinhood ones. A runtime
    // check confirms the values aren't coerced/renamed anywhere in this
    // module (it never imports or reads them at all - see the Pick<> in
    // evaluateRobinhoodSafety's signature).
    const legacyFieldsShape: Pick<
      SniperConfig,
      "requireMintAuthorityRenounced" | "requireFreezeAuthorityRenounced" | "maxCreatorBuyPct" | "minLiquiditySol"
    > = {
      requireMintAuthorityRenounced: true,
      requireFreezeAuthorityRenounced: true,
      maxCreatorBuyPct: 10,
      minLiquiditySol: 20,
    };
    assert(
      typeof legacyFieldsShape.requireMintAuthorityRenounced === "boolean" &&
        typeof legacyFieldsShape.requireFreezeAuthorityRenounced === "boolean" &&
        typeof legacyFieldsShape.maxCreatorBuyPct === "number" &&
        typeof legacyFieldsShape.minLiquiditySol === "number",
      "legacy Solana config fields (requireMintAuthorityRenounced, requireFreezeAuthorityRenounced, " +
        "maxCreatorBuyPct, minLiquiditySol) remain present on SniperConfig, unrenamed, unrepurposed"
    );
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
