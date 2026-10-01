/**
 * Focused tests for the "finalize Robinhood paper semantics" hardening
 * pass:
 *   1. lib/agent/analyze-loss.ts - chain-aware post-mortem payload/schema
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
  ROBINHOOD_ANALYSIS_SCHEMA,
  sanitizeSuggestedConfigForChain,
  type SuggestedConfigDiff,
} from "@/lib/agent/analyze-loss";
import { sanitize } from "@/lib/sniper/effective-config";
import { envSeededDefaults } from "@/lib/sniper/config";

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

// ═══ 1a. Solana schema retains maxCreatorBuyPct exactly as before ═══════
{
  const keys = schemaSuggestedConfigKeys(ANALYSIS_SCHEMA);
  assert(keys.includes("maxCreatorBuyPct"), "Solana ANALYSIS_SCHEMA's suggestedConfig still offers maxCreatorBuyPct");
  for (const common of [
    "takeProfitPct",
    "stopLossPct",
    "trailingStopEnabled",
    "trailingStopActivationPct",
    "trailingStopPct",
    "breakevenAfterPct",
    "maxHoldTimeSec",
    "crashDropPct",
    "cooldownAfterLossSec",
  ]) {
    assert(keys.includes(common), `Solana schema still offers common knob "${common}"`);
  }
}

// ═══ 1b. Robinhood schema never exposes maxCreatorBuyPct ═════════════════
{
  const keys = schemaSuggestedConfigKeys(ROBINHOOD_ANALYSIS_SCHEMA);
  assert(!keys.includes("maxCreatorBuyPct"), "Robinhood ROBINHOOD_ANALYSIS_SCHEMA's suggestedConfig never offers maxCreatorBuyPct");
  for (const common of [
    "takeProfitPct",
    "stopLossPct",
    "trailingStopEnabled",
    "trailingStopActivationPct",
    "trailingStopPct",
    "breakevenAfterPct",
    "maxHoldTimeSec",
    "crashDropPct",
    "cooldownAfterLossSec",
  ]) {
    assert(keys.includes(common), `Robinhood schema still offers common knob "${common}"`);
  }
  assertEqual(
    ROBINHOOD_ANALYSIS_SCHEMA.properties.suggestedConfig.additionalProperties,
    false,
    "Robinhood schema's suggestedConfig is additionalProperties:false - the model cannot invent a field outside the listed set"
  );
}

// ═══ 1c. sanitizeSuggestedConfigForChain - defense in depth ══════════════
{
  const solanaConfig: SuggestedConfigDiff = { maxCreatorBuyPct: 5, takeProfitPct: 40 };
  const result = sanitizeSuggestedConfigForChain(solanaConfig, "solana");
  assertEqual(result, solanaConfig, "Solana loss retains maxCreatorBuyPct - sanitizeSuggestedConfigForChain is a no-op for chain=solana");
}
{
  const solanaConfig: SuggestedConfigDiff = { maxCreatorBuyPct: 5, takeProfitPct: 40 };
  // Legacy rows with chain=null must behave like Solana (unchanged).
  const result = sanitizeSuggestedConfigForChain(solanaConfig, null);
  assertEqual(result, solanaConfig, "chain=null (legacy Solana row) retains maxCreatorBuyPct unchanged");
}
{
  const robinhoodLeakedConfig = { maxCreatorBuyPct: 5, takeProfitPct: 40 } as SuggestedConfigDiff;
  const result = sanitizeSuggestedConfigForChain(robinhoodLeakedConfig, "robinhood");
  assert(
    result != null && !("maxCreatorBuyPct" in result),
    "no Robinhood loss can carry a Solana-only maxCreatorBuyPct suggestion through, even if one leaked past schema enforcement"
  );
  assertEqual((result as SuggestedConfigDiff)?.takeProfitPct, 40, "other common fields are preserved after stripping maxCreatorBuyPct");
}
{
  const result = sanitizeSuggestedConfigForChain(null, "robinhood");
  assertEqual(result, null, "sanitizeSuggestedConfigForChain(null, ...) stays null (no config change applies)");
}
{
  const cleanConfig: SuggestedConfigDiff = { takeProfitPct: 40 };
  const result = sanitizeSuggestedConfigForChain(cleanConfig, "robinhood");
  assertEqual(result, cleanConfig, "a Robinhood suggestedConfig with no maxCreatorBuyPct passes through unchanged (same object, not a needless copy)");
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
  assertEqual(overlay.nativeSymbol, "SOL", 'nativeSymbol="SOL" remains valid for compatibility');
}
{
  const overlay = sanitize({ maxNativePerSnipe: null, maxNativeDeployed: null, maxDailyDrawdownNative: null, nativeSymbol: null });
  assertEqual(overlay.maxNativePerSnipe, null, "explicit null maxNativePerSnipe is accepted (clears/unsets an override)");
  assertEqual(overlay.nativeSymbol, null, "explicit null nativeSymbol is accepted");
}
{
  // House ETH-native limits flow through getEffectiveConfig's base spread
  // (envSeededDefaults represents the no-DB fallback shape of the house
  // config; the { ...base, ...overlay } merge in getEffectiveConfig
  // means any field the overlay doesn't touch - including these - comes
  // straight from base, unchanged by this PR).
  const base = envSeededDefaults();
  const overlay = sanitize({}); // bot with no config overrides at all
  const effective = { ...base, ...overlay };
  assertEqual(effective.maxNativePerSnipe, base.maxNativePerSnipe, "house maxNativePerSnipe flows through when a bot has no override");
  assertEqual(effective.nativeSymbol, base.nativeSymbol, "house nativeSymbol flows through when a bot has no override");
}
{
  const base = { ...envSeededDefaults(), maxNativePerSnipe: 0.02, nativeSymbol: "ETH" };
  const overlay = sanitize({ maxNativePerSnipe: 0.05 });
  const effective = { ...base, ...overlay };
  assertEqual(effective.maxNativePerSnipe, 0.05, "a valid per-bot maxNativePerSnipe override replaces the house value");
  assertEqual(effective.nativeSymbol, "ETH", "an untouched field (nativeSymbol) still comes from the house base");
}

// ═══ Solana per-bot fields still behave exactly as before ════════════════
{
  const overlay = sanitize({ maxSolPerSnipe: 0.08, maxTotalDeployedSol: 0.3, maxDailyDrawdownSol: 0.2 });
  assertEqual(overlay.maxSolPerSnipe, 0.08, "maxSolPerSnipe overlay unchanged");
  assertEqual(overlay.maxTotalDeployedSol, 0.3, "maxTotalDeployedSol overlay unchanged");
  assertEqual(overlay.maxDailyDrawdownSol, 0.2, "maxDailyDrawdownSol overlay unchanged");
}
{
  const overlay = sanitize({ maxSolPerSnipe: "bad" });
  assert(!("maxSolPerSnipe" in overlay), "invalid maxSolPerSnipe still rejected exactly as before");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
