import type { Position } from "@/lib/db/schema";
import type { SniperConfig } from "@/lib/sniper/config";

/**
 * Robinhood risk/sizing. Reads only the native maxNativePerSnipe/
 * maxNativeDeployed/maxDailyDrawdownNative/nativeSymbol fields and fails
 * closed when they aren't explicitly configured for ETH.
 *
 * maxConcurrentPositions and cooldownAfterLossSec are chain-neutral
 * counts/durations, not currency amounts, and maxConcurrentPositions is
 * wallet-global (see canOpenNewRobinhoodPosition below).
 */

/** How long a quiet period must be before a losing streak stops counting,
 * and how long a consecutive-loss pause lasts. Chosen to outlast the market
 * condition that caused the streak without costing the agent a whole day;
 * it is deliberately much longer than the 300s position hold cap. */
export const STREAK_RESET_MS = 30 * 60 * 1000;

/** Circuit-breaker state, re-derived from a wallet's own trades (never
 * persisted - see userBots.breakerResetAt in lib/db/schema.ts). */
export type BreakerState = {
  tradingPaused: boolean;
  pauseReason: string | null;
  lastLossAt: Date | null;
};

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
 * treats an unset or non-ETH nativeSymbol as ETH.
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
 * single wallet-global cap. `robinhoodOpenPositions` must be pre-filtered
 * to chain="robinhood" only - the deployed-native sum below reads ONLY
 * `sizeNative` from these.
 */
export function canOpenNewRobinhoodPosition(
  allOpenPositions: Pick<Position, "id">[],
  robinhoodOpenPositions: Pick<Position, "sizeNative">[],
  breakerState: BreakerState | null,
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
 * Per-wallet circuit breaker: trips on a current consecutive-loss streak
 * (a streak older than STREAK_RESET_MS no longer counts) or on the rolling
 * 24h native drawdown limit, and self-heals the moment the underlying
 * trades no longer breach them.
 */
export function deriveRobinhoodTradingPause(
  stats: DerivedRobinhoodTradeStats,
  config: Pick<SniperConfig, "maxConsecutiveLosses">,
  limits: RobinhoodNativeLimits
): BreakerState {
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
