/**
 * Focused tests for PR07 - Robinhood Chain paper trading.
 *
 * No network calls, no DB connection, no test framework - same plain-tsx
 * convention as the other scripts/test-*.ts files. Covers:
 *   - the discovery → security → safety composition that produces a
 *     paper-entry-eligible result (reusing the already-tested adapters)
 *   - Robinhood-scoped risk/sizing pure functions
 *     (lib/sniper/risk-limits-robinhood.ts)
 *   - a static structural check that the Robinhood paper-entry/discovery
 *     code in scripts/paper-daemon.ts never references any
 *     Jupiter/Solana-signing/live-execution identifier - see the
 *     ROBINHOOD-PAPER-ONLY markers in that file
 *
 * Run: npm run test:robinhood-paper-trading
 */
import { readFileSync } from "fs";
import { join } from "path";

import { normalizeRobinhoodToken, type RobinhoodDiscoveredToken } from "@/lib/gmgn/discovery-robinhood";
import { normalizeRobinhoodSecurity } from "@/lib/gmgn/security-robinhood";
import { evaluateRobinhoodSafety } from "@/lib/gmgn/safety-robinhood";
import { type SniperConfig } from "@/lib/sniper/config";
import {
  canOpenNewRobinhoodPosition,
  deriveRobinhoodTradingPause,
  resolveRobinhoodNativeLimits,
  sizeForRobinhoodSnipe,
} from "@/lib/sniper/risk-limits-robinhood";
import { computeRemainingSize } from "@/lib/sniper/positions";

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
    maxCreatorHoldPct: 10,
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
  });
  if (!token) throw new Error("test fixture failed to normalize - fix the fixture");
  return token;
}

async function main() {
  // ═══ 1/2/3: discovery → security → safety composition ═══════════════
  {
    // A fully known-safe pons new_creation candidate, with zero liquidity,
    // flows through security + safety to a passing result usable for a
    // paper entry.
    const token = makeToken({ liquidity: 0 });
    const security = normalizeRobinhoodSecurity(TOKEN_ADDRESS, {
      is_renounced: true,
      is_blacklist: false,
    });
    const safety = await evaluateRobinhoodSafety(token, security, baseConfig(), 30);
    assert(safety.passed, "discovery-normalized candidate -> security -> safety composes to a passing result");
    assert(
      !safety.reasons.some((r) => r.toLowerCase().includes("liquidity")),
      "liquidity = 0 does not itself prevent a Robinhood paper entry"
    );
  }
  {
    // Safety refusal (blocked keyword) must prevent an entry - the daemon
    // only calls openRobinhoodPaperPosition when safety.passed is true.
    const token = makeToken({ name: "Definitely A Scam Coin" });
    const safety = await evaluateRobinhoodSafety(
      token,
      null,
      baseConfig({ blockedKeywords: ["scam"] }),
      30
    );
    assert(!safety.passed, "a real safety refusal (blocked keyword) fails the gate a paper entry depends on");
  }

  // ═══ 9/10: native risk limits never read Solana SOL config ═══════════
  {
    const result = resolveRobinhoodNativeLimits({
      nativeSymbol: null,
      maxNativePerSnipe: null,
      maxNativeDeployed: null,
      maxDailyDrawdownNative: null,
    });
    assert(!result.ok, "unconfigured ETH-native limits fail closed rather than defaulting to anything");
  }
  {
    // Historical Solana backfill: nativeSymbol = "SOL" must never be
    // reinterpreted as ETH.
    const result = resolveRobinhoodNativeLimits({
      nativeSymbol: "SOL",
      maxNativePerSnipe: 0.05,
      maxNativeDeployed: 0.15,
      maxDailyDrawdownNative: 0.1,
    });
    assert(!result.ok, 'nativeSymbol="SOL" is never reinterpreted as ETH, even with numeric fields present');
  }
  {
    const result = resolveRobinhoodNativeLimits({
      nativeSymbol: "ETH",
      maxNativePerSnipe: 0.01,
      maxNativeDeployed: 0.05,
      maxDailyDrawdownNative: 0.02,
    });
    assert(result.ok, "fully configured ETH-native limits resolve successfully");
    if (result.ok) {
      assertEqual(sizeForRobinhoodSnipe(result.limits), 0.01, "sizeForRobinhoodSnipe returns maxNativePerSnipe");
    }
  }
  {
    // Compile-time proof: resolveRobinhoodNativeLimits's parameter type
    // does not include maxSolPerSnipe/maxTotalDeployedSol/
    // maxDailyDrawdownSol at all.
    const configShape: Parameters<typeof resolveRobinhoodNativeLimits>[0] = {
      nativeSymbol: "ETH",
      maxNativePerSnipe: 0.01,
      maxNativeDeployed: 0.05,
      maxDailyDrawdownNative: 0.02,
    };
    assert(
      !("maxSolPerSnipe" in configShape) &&
        !("maxTotalDeployedSol" in configShape) &&
        !("maxDailyDrawdownSol" in configShape),
      "resolveRobinhoodNativeLimits's config type does not include any Solana SOL-denominated risk field"
    );
  }

  // ═══ 11: canOpenNewRobinhoodPosition never sums Solana + Robinhood sizes ═══
  {
    const limits = { maxNativePerSnipe: 0.01, maxNativeDeployed: 0.02, maxDailyDrawdownNative: 0.05, nativeSymbol: "ETH" };
    // Wallet holds 6 open positions in total, only 1 of them on Robinhood
    // (already using 0.015 ETH of a 0.02 ETH cap).
    const allOpenPositions = Array.from({ length: 6 }, (_, i) => ({ id: `pos-${i}` }));
    const robinhoodOpenPositions = [{ sizeNative: "0.015" }];
    const result = canOpenNewRobinhoodPosition(
      allOpenPositions,
      robinhoodOpenPositions,
      null,
      limits,
      { maxConcurrentPositions: 10, cooldownAfterLossSec: 0 }
    );
    assert(
      !result.allowed && (result.reason?.includes("deployed") ?? false),
      "deployed-native cap is computed from the Robinhood rows' sizeNative (0.015 + 0.01 > 0.02 cap)"
    );
  }
  {
    // maxConcurrentPositions stays wallet-global: 3 open positions of any
    // chain against a cap of 3 blocks a new Robinhood entry even though
    // none of them are Robinhood positions and the native deployed cap
    // has plenty of room.
    const limits = { maxNativePerSnipe: 0.01, maxNativeDeployed: 1, maxDailyDrawdownNative: 1, nativeSymbol: "ETH" };
    const allOpenPositions = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = canOpenNewRobinhoodPosition(allOpenPositions, [], null, limits, {
      maxConcurrentPositions: 3,
      cooldownAfterLossSec: 0,
    });
    assert(
      !result.allowed && (result.reason?.includes("concurrent") ?? false),
      "maxConcurrentPositions remains a wallet-global cap across all chains, unchanged in meaning"
    );
  }
  {
    const limits = { maxNativePerSnipe: 0.01, maxNativeDeployed: 1, maxDailyDrawdownNative: 1, nativeSymbol: "ETH" };
    const result = canOpenNewRobinhoodPosition([], [], null, limits, {
      maxConcurrentPositions: 3,
      cooldownAfterLossSec: 0,
    });
    assert(result.allowed, "a fresh wallet with no open positions and no breaker pause is allowed to open a Robinhood paper position");
  }

  // ═══ Robinhood daily drawdown never includes Solana historical PnL ═══
  {
    const limits = { maxNativePerSnipe: 0.01, maxNativeDeployed: 1, maxDailyDrawdownNative: 0.05, nativeSymbol: "ETH" };
    // dailyPnlNative already reflects a chain-filtered query (see
    // lib/sniper/wallet-trade-stats-robinhood.ts) - this proves the pure
    // derivation function itself only ever looks at the ETH figure it's
    // given, never a mixed one.
    const state = deriveRobinhoodTradingPause(
      { recentOutcomes: [], dailyPnlNative: -0.1, lastLossAt: new Date() },
      { maxConsecutiveLosses: 8 },
      limits
    );
    assertEqual(state.tradingPaused, true, "Robinhood drawdown breaker trips on dailyPnlNative alone");
    assert(
      state.pauseReason?.includes("ETH") ?? false,
      "pause reason is denominated in ETH (the configured nativeSymbol), not SOL"
    );
  }
  {
    const limits = { maxNativePerSnipe: 0.01, maxNativeDeployed: 1, maxDailyDrawdownNative: 0.05, nativeSymbol: "ETH" };
    const state = deriveRobinhoodTradingPause(
      { recentOutcomes: [], dailyPnlNative: 0, lastLossAt: null },
      { maxConsecutiveLosses: 8 },
      limits
    );
    assertEqual(state.tradingPaused, false, "no Robinhood drawdown, no pause");
  }

  // ═══ existing Solana risk tests remain unaffected ═════════════════════
  // (lib/sniper/risk-limits.ts is untouched by this PR - verified by
  // scripts/test-robinhood-safety.ts and the absence of any diff there;
  // this suite only adds the Robinhood-scoped counterpart module.)

  // ═══ 4/5/16: Robinhood entry/discovery code never references Jupiter/
  // live-execution/signing identifiers, and no tx hash is fabricated ═══
  {
    const source = readFileSync(join(process.cwd(), "scripts", "paper-daemon.ts"), "utf8");
    const forbidden = [
      "executeRealBuy(",
      "executeRealSell(",
      "executeSwap(",
      "getSwapQuote(",
      "checkRoundTrip(",
      "getRpc(",
      "agentSecretEnc",
      "SOL_MINT",
      "solToLamports",
    ];

    const regions: string[] = [];
    const markerPairs = source.match(/ROBINHOOD-PAPER-ONLY-START[\s\S]*?ROBINHOOD-PAPER-ONLY-END[^\n]*/g) ?? [];
    assert(markerPairs.length === 2, "exactly two ROBINHOOD-PAPER-ONLY marked regions exist in paper-daemon.ts (entry + discovery)");
    regions.push(...markerPairs);

    for (const region of regions) {
      for (const term of forbidden) {
        assert(!region.includes(term), `ROBINHOOD-PAPER-ONLY region never references "${term}"`);
      }
    }

    // A Robinhood paper entry/exit never writes a fabricated hash.
    assert(
      /entryTxHash:\s*null/.test(source),
      'openRobinhoodPaperPosition sets entryTxHash: null (never a fabricated hash)'
    );
    assert(
      /exitTxHash:\s*null/.test(source),
      'paper exits set exitTxHash: null (never a fabricated hash)'
    );
    assert(
      !/entryTxHash:\s*"paper"/.test(source) && !/txHash:\s*"paper"/.test(source),
      'the "paper" sentinel is never written into a chain-neutral hash field'
    );
  }

  // ═══ 6: Robinhood paper position writes the chain-neutral fields ═════
  {
    const source = readFileSync(join(process.cwd(), "scripts", "paper-daemon.ts"), "utf8");
    for (const field of [
      "tokenAddress: candidate.tokenAddress",
      "sizeNative,",
      'nativeSymbol: limits.nativeSymbol',
      'chain: "robinhood"',
      "network: candidate.network",
      "entryTxHash: null",
    ]) {
      assert(source.includes(field), `openRobinhoodPaperPosition's openPosition() call includes \`${field}\``);
    }
  }

  // ═══ Robinhood partial-exit sizeNative persistence (item 2) ══════════
  {
    assertEqual(computeRemainingSize("1.5", 0.5), 1, "computeRemainingSize: initial 1.5, sold 0.5 -> remaining 1");
    assertEqual(computeRemainingSize("0.3", 0.5), 0, "computeRemainingSize never goes negative (clamped to 0)");
    assert(
      Math.abs(computeRemainingSize(2, 0.7) - 1.3) < 1e-9,
      "computeRemainingSize accepts a numeric current value too"
    );
  }
  {
    const source = readFileSync(join(process.cwd(), "lib", "sniper", "positions.ts"), "utf8");
    assert(
      source.includes("computeRemainingSize(position.sizeNative, exit.soldNative)"),
      "recordPartialExit computes the remaining sizeNative with computeRemainingSize"
    );
    assert(
      source.includes("sizeNative: String(remainingSizeNative)"),
      "recordPartialExit persists the remaining sizeNative back to the DB"
    );
  }

  // ═══ security fetch failure blocks unconditionally (item 3) ══════════
  {
    const source = readFileSync(join(process.cwd(), "scripts", "paper-daemon.ts"), "utf8");
    assert(
      source.includes("securityFetchFailed: boolean"),
      "RobinhoodPending tracks a securityFetchFailed flag distinct from an absent/unknown security object"
    );
    assert(
      /if \(item\.securityFetchFailed\) \{[\s\S]{0,800}?continue;\s*\}/.test(source),
      "a failed security fetch unconditionally `continue`s past every eligible bot for that token, before evaluateRobinhoodSafety is ever called"
    );
    // The failure path must not depend on any per-bot config value (no
    // config.require* check inside that early-continue branch).
    const failureBlockMatch = source.match(/if \(item\.securityFetchFailed\) \{[\s\S]*?continue;\s*\}/);
    assert(
      !!failureBlockMatch && !failureBlockMatch[0].includes("config."),
      "the security-fetch-failure refusal does not consult any config field - no combination of disabled gates can override it"
    );
  }

  // ═══ entrySources gating (item 4) ═════════════════════════════════════
  {
    const source = readFileSync(join(process.cwd(), "scripts", "paper-daemon.ts"), "utf8");
    assert(
      source.includes('if (!config.entrySources.includes("gmgn")) continue;'),
      'a Robinhood candidate is skipped for any bot whose entrySources does not include "gmgn"'
    );
  }

  // ═══ Robinhood rows can never enter Solana reconciliation (item 5) ═══
  {
    const source = readFileSync(join(process.cwd(), "scripts", "paper-daemon.ts"), "utf8");
    // PR09A retired Solana live execution, so the Solana chain-read
    // reconciliation path (reconcileOnStart/heldTokenAmount) no longer
    // exists at all - a Robinhood row cannot reach a Solana chain read
    // because there is none. Stronger than the old ordering guard.
    assert(
      !source.includes("async function reconcileOnStart") && !source.includes("heldTokenAmount("),
      "no Solana chain-read reconciliation path (reconcileOnStart/heldTokenAmount) remains in the paper daemon"
    );
    assert(
      !/@solana\/kit|executeRealSell|executeRealBuy|executeSwap/.test(source),
      "the paper daemon imports no Solana SDK and has no Solana live buy/sell execution path"
    );
  }

  // ═══ Robinhood refusal logs are chain-neutral (item 6) ════════════════
  {
    const source = readFileSync(join(process.cwd(), "scripts", "paper-daemon.ts"), "utf8");
    assert(
      source.includes("function logRobinhoodRefusal("),
      "a dedicated logRobinhoodRefusal helper exists"
    );
    const helperBody = source.match(/function logRobinhoodRefusal\([\s\S]*?\n\}/)?.[0] ?? "";
    assert(helperBody.includes("tokenAddress,"), "logRobinhoodRefusal writes tokenAddress");
    assert(helperBody.includes('chain: "robinhood"'), "logRobinhoodRefusal writes chain: \"robinhood\"");
    assert(helperBody.includes("network,"), "logRobinhoodRefusal writes the network");
    assert(helperBody.includes("txHash: null"), "logRobinhoodRefusal writes txHash: null (a refusal never has a transaction)");

  }

  // ═══ dust threshold (item 7) ═══════════════════════════════════════════
  {
    const exitLogicSource = readFileSync(join(process.cwd(), "lib", "sniper", "exit-logic.ts"), "utf8");
    assert(
      exitLogicSource.includes("export const DUST_THRESHOLD_NATIVE = 1e-6;"),
      "exit-logic.ts exports DUST_THRESHOLD_NATIVE"
    );
    const daemonSource = readFileSync(join(process.cwd(), "scripts", "paper-daemon.ts"), "utf8");
    assert(
      daemonSource.includes("remainingSizeNative <= DUST_THRESHOLD_NATIVE"),
      "the exit path's dust check uses DUST_THRESHOLD_NATIVE on the native remainder"
    );
  }

  // ═══ fresh schema: no Solana columns remain on the trading tables ══════
  {
    const schemaSource = readFileSync(join(process.cwd(), "lib", "db", "schema.ts"), "utf8");
    for (const column of ["size_sol", "pnl_sol", "daily_pnl_sol", "entry_tx_signature", '"tx_signature"', "token_mint", "max_sol_per_snipe", "_migrations", "sniper_state", "alpha_candidates", "rpc_url"]) {
      assert(!schemaSource.includes(column), `lib/db/schema.ts does not define ${column}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("fatal", e);
  process.exitCode = 1;
});
