/**
 * Focused tests for the PR06 Robinhood safety foundation:
 * lib/gmgn/safety-robinhood.ts, lib/gmgn/security-robinhood.ts,
 * lib/chain/alpha-wallets-robinhood.ts.
 *
 * No network calls (alpha-wallet checks use invalid/empty inputs so the
 * RPC path is never actually hit) — same plain-tsx-script convention as
 * scripts/test-gmgn-robinhood-adapter.ts.
 *
 * Run: npm run test:robinhood-safety
 */
import { evaluateRobinhoodSafety } from "@/lib/gmgn/safety-robinhood";
import { normalizeRobinhoodSecurity } from "@/lib/gmgn/security-robinhood";
import { normalizeRobinhoodToken, type RobinhoodDiscoveredToken } from "@/lib/gmgn/discovery-robinhood";
import { checkAlphaWalletBuyRobinhood } from "@/lib/chain/alpha-wallets-robinhood";
import type { SniperConfig } from "@/lib/sniper/config";

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
  | "requireMintAuthorityRenounced"
  | "requireFreezeAuthorityRenounced"
  | "requireSocialLink"
  | "requireAlphaWalletBuy"
  | "alphaWallets"
  | "maxCreatorBuyPct"
  | "blockedKeywords"
  | "minTokenAgeSec"
  | "maxTokenAgeSec"
> {
  return {
    requireMintAuthorityRenounced: false,
    requireFreezeAuthorityRenounced: false,
    requireSocialLink: false,
    requireAlphaWalletBuy: false,
    alphaWallets: [],
    maxCreatorBuyPct: 10,
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
    launchpad_platform: "flap",
    ...overrides,
  });
  if (!token) throw new Error("test fixture failed to normalize — fix the fixture");
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
    // link fields empty — the normalizer's only way to represent
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

  // ═══ owner-renounced kept distinct from mint-authority semantics ═════
  {
    const token = makeToken({});
    const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, {
      is_renounced: true,
      renounced_mint: false, // deliberately disagreeing, as live-observed
    });
    const result = await evaluateRobinhoodSafety(
      token,
      security,
      baseConfig({ requireMintAuthorityRenounced: true }),
      30
    );
    assertEqual(result.ownerRenounced, true, "ownerRenounced reflects is_renounced");
    assert(
      result.reasons.some((r) => r.includes("mint-authority-equivalent unavailable")),
      "requireMintAuthorityRenounced=true still refuses via the explicit blocker, even though ownerRenounced=true"
    );
  }
  {
    const token = makeToken({});
    const result = await evaluateRobinhoodSafety(
      token,
      null,
      baseConfig({ requireMintAuthorityRenounced: false }),
      30
    );
    assert(
      !result.reasons.some((r) => r.includes("mint-authority-equivalent")),
      "requireMintAuthorityRenounced=false does not trigger the blocker reason"
    );
  }

  // ═══ missing freeze-equivalent is not silently passed ════════════════
  {
    const token = makeToken({});
    const result = await evaluateRobinhoodSafety(
      token,
      null,
      baseConfig({ requireFreezeAuthorityRenounced: true }),
      30
    );
    assertEqual(result.freezeEquivalentAvailable, false, "freezeEquivalentAvailable is structurally false");
    assert(
      result.reasons.some((r) => r.includes("freeze-authority-equivalent unavailable")),
      "requireFreezeAuthorityRenounced=true → explicit blocker refusal, not a silent pass"
    );
  }

  // ═══ creator current holding is NOT used as creator initial buy % ════
  // ═══ missing creator-buy data produces the explicit blocker ══════════
  {
    const token = makeToken({});
    const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, {});
    // creator_balance_rate = 0 (a low CURRENT holding) must not be read
    // as "creator didn't buy much at launch" — the blocker fires
    // regardless of what creator_balance_rate says, because that's a
    // different fact entirely.
    const result = await evaluateRobinhoodSafety(token, security, baseConfig({ maxCreatorBuyPct: 10 }), 30);
    assertEqual(result.creatorInitialBuyPctAvailable, false, "creatorInitialBuyPctAvailable is structurally false");
    assert(
      result.reasons.some((r) => r.includes("creator initial-buy percentage unavailable")),
      "creator-buy blocker always fires — never silently skipped, never satisfied by creator_balance_rate"
    );
    assertEqual(result.passed, false, "a candidate cannot pass while the creator-buy blocker is unconditional");
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
      !result.reasons.some((r) => r.includes("honeypot")),
      "is_honeypot=unknown → not refused (matches existing Solana/GMGN behavior: only an explicit true refuses)"
    );
  }

  // ═══ buy/sell tax percentages + out-of-range ══════════════════════════
  {
    const token = makeToken({ sell_tax: 0.0899 }); // 8.99%, over the 5% floor
    const result = await evaluateRobinhoodSafety(token, null, baseConfig(), 30);
    assert(result.reasons.some((r) => r.includes("sell tax")), "sell tax over floor → refused");
  }
  {
    const token = makeToken({ buy_tax: 0.02 }); // 2%, under the 5% floor
    const result = await evaluateRobinhoodSafety(token, null, baseConfig(), 30);
    assert(!result.reasons.some((r) => r.includes("buy tax")), "buy tax under floor → not refused");
  }
  {
    // Out-of-range ratio already normalizes to null at the discovery
    // layer (PR05); confirming the safety evaluator doesn't choke on it
    // or treat null as a pass-through zero.
    const token = makeToken({ buy_tax: 1.5 });
    assertEqual(token.buyTaxPct, null, "out-of-range buy_tax is null by the time it reaches the evaluator");
    const result = await evaluateRobinhoodSafety(token, null, baseConfig(), 30);
    assert(!result.reasons.some((r) => r.includes("buy tax")), "null buyTaxPct doesn't trigger a tax refusal");
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

  // ═══ liquidity units are not assumed ═════════════════════════════════
  {
    // A token with liquidity far below any SOL-shaped threshold must not
    // be refused for liquidity — there is no liquidity check at all in
    // this evaluator (see module comment: policy conversion not made).
    const token = makeToken({ liquidity: 0.001 });
    const result = await evaluateRobinhoodSafety(token, null, baseConfig(), 30);
    assert(!result.reasons.some((r) => r.includes("liquidity")), "no liquidity threshold is enforced (unit mismatch unresolved)");
  }

  // ═══ safety-critical unknown values do not silently pass ═════════════
  {
    // requireSocialLink + requireMintAuthorityRenounced + requireFreezeAuthorityRenounced
    // all on, nothing known → must refuse on all fronts, never a pass.
    const token = makeToken({});
    const result = await evaluateRobinhoodSafety(
      token,
      null,
      baseConfig({
        requireSocialLink: true,
        requireMintAuthorityRenounced: true,
        requireFreezeAuthorityRenounced: true,
      }),
      30
    );
    assertEqual(result.passed, false, "every safety-critical unknown compounds into a refusal, never a pass");
    assert(result.reasons.length >= 4, "multiple distinct blocker/refusal reasons are all surfaced, not collapsed");
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
