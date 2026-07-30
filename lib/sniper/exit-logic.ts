import type { LogLevel } from "@/lib/logs";
import type { SniperConfig } from "@/lib/sniper/config";

/**
 * Pure trading math extracted from scripts/sniper-daemon.ts#checkExits so
 * both the house daemon and any other execution loop (e.g. a per-user
 * paper daemon) run the exact same tested exit logic instead of forking
 * it. No DB, no logging, no side effects — callers own persistence and
 * signing/selling.
 */

// Below this remaining SOL, treat a tiered position as fully exited rather
// than leaving a dust-sized "open" row behind. Shared with the tiered-ladder
// caller loop, which stops issuing further sells once a position hits this.
export const DUST_THRESHOLD_SOL = 1e-6;

export type FullExitInput = {
  entryPrice: number;
  sizeSol: number;
  /** Previously recorded price, if any — drives the crash-exit check. */
  lastPrice: number | null;
  /** Previously recorded high-water mark, if any. */
  peakPrice: number | null;
  openedAt: Date;
};

type FullExitConfig = Pick<
  SniperConfig,
  | "trailingStopEnabled"
  | "breakevenAfterPct"
  | "crashDropPct"
  | "maxHoldTimeSec"
  | "trailingStopActivationPct"
  | "trailingStopPct"
  | "stopLossPct"
  | "exitMode"
  | "takeProfitPct"
>;

export type FullExitDecision =
  | { peakPrice: number | null; exit: false }
  | {
      peakPrice: number | null;
      exit: true;
      reason: string;
      pnlSol: number;
      exitLevel: LogLevel;
    };

/**
 * Evaluates crash-exit, time-exit, trailing-stop, breakeven-stop/stop-loss,
 * and fixed take-profit — whichever full-position exit condition fires
 * first, in that priority order. Always returns the updated `peakPrice`
 * watermark (trailing-stop/breakeven-lock share one "highest price ever
 * seen" value, tracked from open, not just after arming) so the caller can
 * persist it via updatePositionPrice whether or not an exit fired.
 */
export function evaluateFullExit(
  input: FullExitInput,
  config: FullExitConfig,
  currentPrice: number
): FullExitDecision {
  const { entryPrice, sizeSol, lastPrice: previousPrice, openedAt } = input;
  const changePct = ((currentPrice - entryPrice) / entryPrice) * 100;

  const trackPeak = config.trailingStopEnabled || config.breakevenAfterPct != null;
  let peakPrice = input.peakPrice;
  if (trackPeak && (peakPrice == null || currentPrice > peakPrice)) {
    peakPrice = currentPrice;
  }
  const peakChangePct =
    trackPeak && peakPrice != null ? ((peakPrice - entryPrice) / entryPrice) * 100 : changePct;

  // "Fast out" — a sudden drop since the last check (a live rug/dump in
  // progress) triggers an immediate exit regardless of every other rule
  // below, so a position sitting at +80% that suddenly craters doesn't
  // wait around for a slower stop to eventually catch up.
  const dropSinceLastCheckPct =
    previousPrice != null && previousPrice > 0
      ? ((previousPrice - currentPrice) / previousPrice) * 100
      : null;
  const shouldCrashExit =
    dropSinceLastCheckPct != null && dropSinceLastCheckPct >= config.crashDropPct;

  const holdSec = (Date.now() - openedAt.getTime()) / 1000;
  const shouldTimeExit = config.maxHoldTimeSec != null && holdSec >= config.maxHoldTimeSec;

  const trailingArmed =
    config.trailingStopEnabled && peakChangePct >= config.trailingStopActivationPct;
  const shouldTrailingExit =
    trailingArmed &&
    peakPrice != null &&
    ((peakPrice - currentPrice) / peakPrice) * 100 >= config.trailingStopPct;

  // Once price has ever reached breakevenAfterPct, the stop floor moves up
  // to entry price (0%) instead of the configured stop-loss distance — this
  // guarantees no loss from that point on, at the cost of a smaller
  // worst-case exit than letting the full stop-loss run.
  const breakevenActive =
    config.breakevenAfterPct != null && peakChangePct >= config.breakevenAfterPct;
  const effectiveStopLossPct = breakevenActive ? 0 : config.stopLossPct;
  const shouldStopLoss = changePct <= -effectiveStopLossPct;

  // The flat take-profit target only drives a full exit in "fixed" mode —
  // in "tiered" mode, profit-taking is handled by evaluateTieredExits,
  // while stop-loss/trailing/crash/time-exit still apply as a safety net.
  const shouldFixedTakeProfit = config.exitMode === "fixed" && changePct >= config.takeProfitPct;

  const shouldFullExit =
    shouldCrashExit || shouldTimeExit || shouldTrailingExit || shouldStopLoss || shouldFixedTakeProfit;

  if (!shouldFullExit) {
    return { peakPrice, exit: false };
  }

  const reason = shouldCrashExit
    ? `crash-detected (${dropSinceLastCheckPct!.toFixed(1)}% in one check)`
    : shouldTimeExit
      ? `time-exit (held ${Math.round(holdSec)}s, max ${config.maxHoldTimeSec}s)`
      : shouldTrailingExit
        ? `trailing-stop (${config.trailingStopPct}% off peak)`
        : shouldStopLoss
          ? breakevenActive
            ? "breakeven-stop"
            : "stop-loss"
          : "take-profit";

  const pnlSol = sizeSol * (changePct / 100);
  // guard = took profit on purpose; warn = a fast-out crash exit (urgent);
  // sell = realized at or below cost.
  const exitLevel: LogLevel = shouldCrashExit ? "warn" : pnlSol >= 0 ? "guard" : "sell";

  return { peakPrice, exit: true, reason, pnlSol, exitLevel };
}

export type TieredExitInput = {
  entryPrice: number;
  sizeSol: number;
  /** Tier indices already triggered on this position — never fires twice. */
  triggeredTiers: number[];
};

type TieredExitConfig = Pick<SniperConfig, "exitMode" | "takeProfitTiers">;

export type TieredExitResult = {
  tierIndex: number;
  sellPortionPct: number;
  /** Absolute SOL sold by this tranche — remainingSizeSol shrinks
   * tier-over-tier within the same evaluation, so this is NOT
   * `sizeSol * sellPortionPct / 100`. */
  soldSol: number;
  pnlSol: number;
};

/**
 * Walks configured tiers ascending; each untriggered tier whose atPct has
 * been crossed sells sellPortionPct of the *currently remaining* size, so a
 * position can ladder through several tiers in one tick if price gapped
 * past more than one at once. Only meaningful when a full exit didn't
 * already fire this tick — callers should skip calling this otherwise (the
 * function itself is defensive and returns [] when exitMode isn't
 * "tiered", but doesn't know about a same-tick full-exit decision).
 *
 * Results are computed sequentially assuming each prior tier in the
 * returned array executes successfully. A caller that stops partway
 * through (e.g. a real sell fails) should simply stop applying results
 * from that point on — everything before it remains valid, since those are
 * exactly the tiers that did succeed.
 */
export function evaluateTieredExits(
  input: TieredExitInput,
  config: TieredExitConfig,
  currentPrice: number
): TieredExitResult[] {
  if (config.exitMode !== "tiered" || config.takeProfitTiers.length === 0) return [];

  const changePct = ((currentPrice - input.entryPrice) / input.entryPrice) * 100;
  const sortedTiers = config.takeProfitTiers
    .map((tier, index) => ({ ...tier, index }))
    .sort((a, b) => a.atPct - b.atPct);

  let remainingSizeSol = input.sizeSol;
  const results: TieredExitResult[] = [];

  for (const tier of sortedTiers) {
    if (input.triggeredTiers.includes(tier.index)) continue;
    if (changePct < tier.atPct) continue;
    if (remainingSizeSol <= DUST_THRESHOLD_SOL) break;

    const soldSol = remainingSizeSol * (tier.sellPortionPct / 100);
    const pnlSol = soldSol * (changePct / 100);
    results.push({ tierIndex: tier.index, sellPortionPct: tier.sellPortionPct, soldSol, pnlSol });
    remainingSizeSol -= soldSol;
  }

  return results;
}
