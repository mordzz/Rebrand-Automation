/**
 * Focused tests for the "finalize Robinhood paper semantics" hardening
 * pass:
 *   1. lib/agent/analyze-loss.ts - post-mortem schema and key allowlist
 *   2. lib/sniper/effective-config.ts - per-bot overlay for the
 *      Robinhood-native risk fields
 *
 * No network/LLM calls (analyzeLoss() itself is not invoked - it always
 * calls the configured LLM provider - only its pure/exported building
 * blocks are tested directly), no DB. Same plain-tsx convention as the
 * other scripts/test-*.ts files.
 *
 * Run: npm run test:analyze-loss-effective-config
 */
import {
  ANALYSIS_SCHEMA,
  sanitizeSuggestedConfig,
  type SuggestedConfigDiff,
} from "@/lib/agent/analyze-loss";
import { sanitize } from "@/lib/sniper/effective-config";
import { defaultSniperConfig } from "@/lib/sniper/config";

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

function schemaSuggestedConfigKeys(schema: {
  properties: { suggestedConfig: { properties: Record<string, unknown> } };
}): string[] {
  return Object.keys(schema.properties.suggestedConfig.properties);
}

// ═══ 1a. The post-mortem schema offers only the strategy/exit knobs ═════
{
  const keys = schemaSuggestedConfigKeys(ANALYSIS_SCHEMA);
  const expected = [
    "takeProfitPct",
    "stopLossPct",
    "trailingStopEnabled",
    "trailingStopActivationPct",
    "trailingStopPct",
    "breakevenAfterPct",
    "maxHoldTimeSec",
    "crashDropPct",
    "cooldownAfterLossSec",
  ];
  assertEqual([...keys].sort(), [...expected].sort(), "ANALYSIS_SCHEMA offers exactly the strategy/exit knobs");
  for (const safety of ["maxCreatorHoldPct", "maxNativePerSnipe", "maxNativeDeployed", "maxDailyDrawdownNative", "maxConcurrentPositions"]) {
    assert(!keys.includes(safety), `post-mortem can never propose safety-critical "${safety}"`);
  }
  assertEqual(
    ANALYSIS_SCHEMA.properties.suggestedConfig.additionalProperties,
    false,
    "suggestedConfig is additionalProperties:false - the model cannot invent a field outside the listed set"
  );
}

// ═══ 1b. sanitizeSuggestedConfig - defense in depth ══════════════════════
{
  const leaked = { maxCreatorHoldPct: 50, maxNativePerSnipe: 9, takeProfitPct: 40 };
  const result = sanitizeSuggestedConfig(leaked);
  assertEqual(result, { takeProfitPct: 40 }, "keys outside the allowed set are stripped even if they leak past schema enforcement");
}
{
  assertEqual(sanitizeSuggestedConfig(null), null, "sanitizeSuggestedConfig(null) stays null (no config change applies)");
}
{
  const clean: SuggestedConfigDiff = { takeProfitPct: 40, maxHoldTimeSec: null };
  assertEqual(sanitizeSuggestedConfig(clean), clean, "an allowed suggestedConfig passes through unchanged");
}

// ═══ 2. effective-config.ts: Robinhood-native per-bot overlay ═══════════
{
  const overlay = sanitize({ maxNativePerSnipe: 0.01, maxNativeDeployed: 0.05, maxDailyDrawdownNative: 0.02, nativeSymbol: "ETH" });
  assertEqual(overlay.maxNativePerSnipe, 0.01, "valid maxNativePerSnipe override passes through sanitize()");
  assertEqual(overlay.maxNativeDeployed, 0.05, "valid maxNativeDeployed override passes through sanitize()");
  assertEqual(overlay.maxDailyDrawdownNative, 0.02, "valid maxDailyDrawdownNative override passes through sanitize()");
  assertEqual(overlay.nativeSymbol, "ETH", 'nativeSymbol="ETH" override passes through sanitize()');
}
{
  const overlay = sanitize({ maxNativePerSnipe: "not-a-number", maxNativeDeployed: Infinity, maxDailyDrawdownNative: NaN });
  assert(!("maxNativePerSnipe" in overlay), "non-numeric maxNativePerSnipe is rejected (dropped) by sanitize()");
  assert(!("maxNativeDeployed" in overlay), "Infinity maxNativeDeployed is rejected (non-finite)");
  assert(!("maxDailyDrawdownNative" in overlay), "NaN maxDailyDrawdownNative is rejected (non-finite)");
}
{
  const overlay = sanitize({ nativeSymbol: "DOGE" });
  assert(!("nativeSymbol" in overlay), 'an unknown nativeSymbol ("DOGE") is rejected, not silently accepted');
}
{
  const overlay = sanitize({ nativeSymbol: "SOL" });
  assert(!("nativeSymbol" in overlay), 'nativeSymbol="SOL" is rejected - only ETH has behavior');
}
{
  const overlay = sanitize({ maxNativePerSnipe: null, maxNativeDeployed: null, maxDailyDrawdownNative: null, nativeSymbol: null });
  assertEqual(overlay.maxNativePerSnipe, null, "explicit null maxNativePerSnipe is accepted (clears/unsets an override)");
  assertEqual(overlay.nativeSymbol, null, "explicit null nativeSymbol is accepted");
}
{
  // House ETH-native limits flow through getEffectiveConfig's base spread:
  // any field the overlay doesn't touch comes straight from base.
  const base = defaultSniperConfig();
  const overlay = sanitize({}); // bot with no config overrides at all
  const effective = { ...base, ...overlay };
  assertEqual(effective.maxNativePerSnipe, base.maxNativePerSnipe, "house maxNativePerSnipe flows through when a bot has no override");
  assertEqual(effective.nativeSymbol, base.nativeSymbol, "house nativeSymbol flows through when a bot has no override");
}
{
  const base = { ...defaultSniperConfig(), maxNativePerSnipe: 0.02, nativeSymbol: "ETH" };
  const overlay = sanitize({ maxNativePerSnipe: 0.05 });
  const effective = { ...base, ...overlay };
  assertEqual(effective.maxNativePerSnipe, 0.05, "a valid per-bot maxNativePerSnipe override replaces the house value");
  assertEqual(effective.nativeSymbol, "ETH", "an untouched field (nativeSymbol) still comes from the house base");
}

// ═══ Retired Solana fields are not accepted by the overlay ══════════════
{
  const overlay = sanitize({ maxSolPerSnipe: 0.08, requireMintAuthorityRenounced: false, minLiquiditySol: 1 });
  assertEqual(Object.keys(overlay), [], "retired Solana config keys are dropped by sanitize()");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
