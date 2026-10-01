import type { Position, SniperState } from "@/drizzle/schema";
import { STREAK_RESET_MS } from "@/lib/sniper/risk-limits";
import type { SniperConfig } from "@/lib/sniper/config";

/**
 * Robinhood-scoped risk/sizing - PR07. Deliberately NOT a reuse of
 * lib/sniper/risk-limits.ts's SOL-denominated functions: those read
 * maxSolPerSnipe/maxTotalDeployedSol/maxDailyDrawdownSol directly, and
 * silently pointing them at ETH amounts would be exactly the invented
 * SOL→ETH conversion this PR must not perform. This module reads only
 * the chain-neutral maxNativePerSnipe/maxNativeDeployed/
 * maxDailyDrawdownNative/nativeSymbol fields (PR04 schema foundation,
 * exposed on SniperConfig in this PR) and fails closed when they aren't
 * explicitly configured for ETH.
 *
 * maxConcurrentPositions and cooldownAfterLossSec ARE reused directly
 * from the shared config - they're chain-neutral counts/durations, not
 * currency amounts, and maxConcurrentPositions is deliberately kept
 * wallet-global (see canOpenNewRobinhoodPosition below) rather than
 * split per chain, preserving its existing single meaning.
 */

export type RobinhoodNativeLimits = {
  maxNativePerSnipe: number;
  maxNativeDeployed: number;
  maxDailyDrawdownNative: number;
  nativeSymbol: string;
};

export type RobinhoodLimitsResult =
  | { ok: true; limits: RobinhoodNativeLimits }
  | { ok: false; reason: string };

/**
 * Resolves the ETH-native risk limits for Robinhood paper trading, or an
 * explicit configuration-blocker reason. Fails closed - never silently
 * reinterprets a Solana `nativeSymbol="SOL"` historical backfill (or an
 * unset one) as ETH, and never derives a number from
 * maxSolPerSnipe/maxTotalDeployedSol/maxDailyDrawdownSol.
 */
export function resolveRobinhoodNativeLimits(
  config: Pick<
    SniperConfig,
    "nativeSymbol" | "maxNativePerSnipe" | "maxNativeDeployed" | "maxDailyDrawdownNative"
  >
): RobinhoodLimitsResult {
  if (config.nativeSymbol !== "ETH") {
    return {
      ok: false,
      reason:
        config.nativeSymbol == null
          ? "Robinhood native risk limits not configured (nativeSymbol unset) - configuration blocker"
          : `Robinhood requires nativeSymbol="ETH"; sniper_config currently has nativeSymbol="${config.nativeSymbol}" - refusing to reinterpret it as ETH`,
    };
  }
  if (config.maxNativePerSnipe == null || !(config.maxNativePerSnipe > 0)) {
    return {
      ok: false,
      reason: "maxNativePerSnipe not configured (must be a positive ETH value) - configuration blocker",
    };
  }
  if (config.maxNativeDeployed == null || !(config.maxNativeDeployed > 0)) {
    return {
      ok: false,
      reason: "maxNativeDeployed not configured (must be a positive ETH value) - configuration blocker",
    };
  }
  if (config.maxDailyDrawdownNative == null || !(config.maxDailyDrawdownNative > 0)) {
    return {
      ok: false,
      reason: "maxDailyDrawdownNative not configured (must be a positive ETH value) - configuration blocker",
    };
  }
  return {
    ok: true,
    limits: {
      maxNativePerSnipe: config.maxNativePerSnipe,
      maxNativeDeployed: config.maxNativeDeployed,
      maxDailyDrawdownNative: config.maxDailyDrawdownNative,
      nativeSymbol: config.nativeSymbol,
    },
  };
}

export function sizeForRobinhoodSnipe(limits: RobinhoodNativeLimits): number {
  return limits.maxNativePerSnipe;
}

/**
 * Robinhood-specific entry gate. `allOpenPositions` must be the wallet's
 * FULL open-position list (every chain) - maxConcurrentPositions stays a
 * single wallet-global cap, unchanged in meaning from the Solana path.
 * `robinhoodOpenPositions` must be pre-filtered to chain="robinhood"
 * only - the deployed-native sum below reads ONLY `sizeNative` from
 * these, and must never be added to any Solana `sizeSol` figure.
 */
export function canOpenNewRobinhoodPosition(
  allOpenPositions: Pick<Position, "id">[],
  robinhoodOpenPositions: Pick<Position, "sizeNative">[],
  breakerState: Pick<SniperState, "tradingPaused" | "pauseReason" | "lastLossAt"> | null,
  limits: RobinhoodNativeLimits,
  config: Pick<SniperConfig, "maxConcurrentPositions" | "cooldownAfterLossSec">
): { allowed: boolean; reason?: string } {
  if (breakerState?.tradingPaused) {
    return { allowed: false, reason: breakerState.pauseReason ?? "trading paused" };
  }
  if (allOpenPositions.length >= config.maxConcurrentPositions) {
    return {
      allowed: false,
      reason: `max concurrent positions (${config.maxConcurrentPositions}) reached`,
    };
  }
  const deployedNative = robinhoodOpenPositions.reduce(
    (sum, p) => sum + Number(p.sizeNative ?? 0),
    0
  );
  if (deployedNative + limits.maxNativePerSnipe > limits.maxNativeDeployed) {
    return {
      allowed: false,
      reason: `max total deployed ${limits.nativeSymbol} (${limits.maxNativeDeployed}) would be exceeded`,
    };
  }
  if (config.cooldownAfterLossSec > 0 && breakerState?.lastLossAt) {
    const elapsedSec = (Date.now() - breakerState.lastLossAt.getTime()) / 1000;
    if (elapsedSec < config.cooldownAfterLossSec) {
      const remaining = Math.ceil(config.cooldownAfterLossSec - elapsedSec);
      return { allowed: false, reason: `cooldown after loss - ${remaining}s remaining` };
    }
  }
  return { allowed: true };
}

export type DerivedRobinhoodTradeStats = {
  recentOutcomes: { pnlNative: string | null; closedAt: Date }[];
  dailyPnlNative: number;
  lastLossAt: Date | null;
};

/**
 * Robinhood counterpart to lib/sniper/risk-limits.ts#deriveTradingPause -
 * identical consecutive-loss/cooldown/streak-reset semantics, reading
 * pnlNative and maxDailyDrawdownNative instead of pnlSol/
 * maxDailyDrawdownSol. maxConsecutiveLosses (a count, not a currency
 * amount) is the same shared config field both chains read.
 */
export function deriveRobinhoodTradingPause(
  stats: DerivedRobinhoodTradeStats,
  config: Pick<SniperConfig, "maxConsecutiveLosses">,
  limits: RobinhoodNativeLimits
): Pick<SniperState, "tradingPaused" | "pauseReason" | "lastLossAt"> {
  let consecutiveLosses = 0;
  let previousClosedAt: Date | null = null;
  for (const trade of stats.recentOutcomes) {
    const pnl = Number(trade.pnlNative ?? 0);
    if (pnl >= 0) break;
    if (
      previousClosedAt != null &&
      previousClosedAt.getTime() - trade.closedAt.getTime() > STREAK_RESET_MS
    ) {
      break;
    }
    consecutiveLosses++;
    previousClosedAt = trade.closedAt;
  }

  const streakIsCurrent =
    stats.lastLossAt != null && Date.now() - stats.lastLossAt.getTime() <= STREAK_RESET_MS;

  if (consecutiveLosses >= config.maxConsecutiveLosses && streakIsCurrent) {
    return {
      tradingPaused: true,
      pauseReason: `${consecutiveLosses} consecutive losses (limit ${config.maxConsecutiveLosses})`,
      lastLossAt: stats.lastLossAt,
    };
  }
  if (stats.dailyPnlNative <= -limits.maxDailyDrawdownNative) {
    return {
      tradingPaused: true,
      pauseReason: `daily drawdown ${stats.dailyPnlNative.toFixed(5)} ${limits.nativeSymbol} exceeded limit ${limits.maxDailyDrawdownNative}`,
      lastLossAt: stats.lastLossAt,
    };
  }
  return { tradingPaused: false, pauseReason: null, lastLossAt: stats.lastLossAt };
}
