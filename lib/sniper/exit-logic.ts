import type { LogLevel } from "@/lib/logs";
import type { SniperConfig } from "@/lib/sniper/config";

/**
 * Pure trading math extracted from the original checkExits so
 * every execution loop (e.g. the per-user paper daemon) run the exact same tested exit logic instead of forking
 * it. No DB, no logging, no side effects - callers own persistence and
 * signing/selling.
 */

// Below this remaining native notional, treat a tiered position as fully
// exited rather than leaving a dust-sized "open" row behind. Shared with the
// tiered-ladder caller loop, which stops issuing further sells once a
// position hits this.
export const DUST_THRESHOLD_NATIVE = 1e-6;

export type FullExitInput = {
  entryPrice: number;
  sizeNative: number;
  /** Previously recorded price, if any - drives the crash-exit check. */
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
      pnlNative: number;
      exitLevel: LogLevel;
      /** The price this exit is modelled as filling at, which for a
       *  threshold exit is the trigger rather than the observed price. */
      fillPrice: number;
    };

/**
 * Evaluates crash-exit, time-exit, trailing-stop, breakeven-stop/stop-loss,
 * and fixed take-profit - whichever full-position exit condition fires
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
  const { entryPrice, sizeNative, lastPrice: previousPrice, openedAt } = input;
  const changePct = ((currentPrice - entryPrice) / entryPrice) * 100;

  const trackPeak = config.trailingStopEnabled || config.breakevenAfterPct != null;
  let peakPrice = input.peakPrice;
  if (trackPeak && (peakPrice == null || currentPrice > peakPrice)) {
    peakPrice = currentPrice;
  }
  const peakChangePct =
    trackPeak && peakPrice != null ? ((peakPrice - entryPrice) / entryPrice) * 100 : changePct;

  // "Fast out" - a sudden drop since the last check (a live rug/dump in
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
  // to entry price (0%) instead of the configured stop-loss distance - this
  // guarantees no loss from that point on, at the cost of a smaller
  // worst-case exit than letting the full stop-loss run.
  const breakevenActive =
    config.breakevenAfterPct != null && peakChangePct >= config.breakevenAfterPct;
  const effectiveStopLossPct = breakevenActive ? 0 : config.stopLossPct;
  const shouldStopLoss = changePct <= -effectiveStopLossPct;

  // The flat take-profit target only drives a full exit in "fixed" mode -
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

  /* The price this exit is modelled as filling at, which is not always the
     price observed.

     A threshold exit cannot be credited with a gap that carried price past
     its own trigger. Observed live: an agent configured to take profit at
     +30% recorded a fill at 8.59x, because the price crossed the threshold
     and kept going inside one check interval, and the fill was booked at
     whatever was then on screen. That single trade turned a losing cohort
     into an apparently profitable one. A real order would have gone out at
     the trigger and been filled with impact, never at the top of the move.

     The asymmetry is deliberate and matches how a gap actually resolves:

       take-profit / tiers  capped at the trigger, no gap upside
       trailing stop        capped at the trailing level
       stop-loss            filled where price is, so gap downside is kept
       crash / time exit    filled where price is, no threshold to cap to

     Applied to paper and live alike, because it is a model of a fill rather
     than a simulation artefact. On a live exit the executed price replaces
     this figure entirely; here it only ever makes the paper record more
     pessimistic, which is the only safe direction for a number an operator
     uses to decide whether to risk real money (§15). */
  const takeProfitPrice = entryPrice * (1 + config.takeProfitPct / 100);
  // shouldTrailingExit already implies a peak was recorded; this keeps that
  // guarantee visible to the type checker rather than asserting it.
  const trailingPrice =
    peakPrice != null ? peakPrice * (1 - config.trailingStopPct / 100) : null;
  const fillPrice = shouldFixedTakeProfit
    ? Math.min(currentPrice, takeProfitPrice)
    : shouldTrailingExit && trailingPrice != null
      ? Math.min(currentPrice, trailingPrice)
      : currentPrice;

  const fillChangePct = ((fillPrice - entryPrice) / entryPrice) * 100;
  const pnlNative = sizeNative * (fillChangePct / 100);
  // guard = took profit on purpose; warn = a fast-out crash exit (urgent);
  // sell = realized at or below cost.
  const exitLevel: LogLevel = shouldCrashExit ? "warn" : pnlNative >= 0 ? "guard" : "sell";

  return { peakPrice, exit: true, reason, pnlNative, exitLevel, fillPrice };
}

export type TieredExitInput = {
  entryPrice: number;
  sizeNative: number;
  /** Tier indices already triggered on this position - never fires twice. */
  triggeredTiers: number[];
};

type TieredExitConfig = Pick<SniperConfig, "exitMode" | "takeProfitTiers">;

export type TieredExitResult = {
  tierIndex: number;
  sellPortionPct: number;
  /** Absolute native amount sold by this tranche - remainingSizeNative shrinks
   * tier-over-tier within the same evaluation, so this is NOT
   * `sizeNative * sellPortionPct / 100`. */
  soldNative: number;
  pnlNative: number;
  /** Modelled fill price for this rung: its own trigger, not the observed
   *  price, so a multi-tier gap cannot book every rung at the top. */
  fillPrice: number;
};

/**
 * Walks configured tiers ascending; each untriggered tier whose atPct has
 * been crossed sells sellPortionPct of the *currently remaining* size, so a
 * position can ladder through several tiers in one tick if price gapped
 * past more than one at once. Only meaningful when a full exit didn't
 * already fire this tick - callers should skip calling this otherwise (the
 * function itself is defensive and returns [] when exitMode isn't
 * "tiered", but doesn't know about a same-tick full-exit decision).
 *
 * Results are computed sequentially assuming each prior tier in the
 * returned array executes successfully. A caller that stops partway
 * through (e.g. a real sell fails) should simply stop applying results
 * from that point on - everything before it remains valid, since those are
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

  let remainingSizeNative = input.sizeNative;
  const results: TieredExitResult[] = [];

  for (const tier of sortedTiers) {
    if (input.triggeredTiers.includes(tier.index)) continue;
    if (changePct < tier.atPct) continue;
    if (remainingSizeNative <= DUST_THRESHOLD_NATIVE) break;

    const soldNative = remainingSizeNative * (tier.sellPortionPct / 100);
    /* At the tier's own trigger, not wherever price reached. A ladder is a
       sequence of thresholds, so the same reasoning as the full-exit cap
       applies to each rung: a gap that clears three tiers at once must book
       three fills at three trigger prices, not three fills at the top. */
    const fillChangePct = Math.min(changePct, tier.atPct);
    const pnlNative = soldNative * (fillChangePct / 100);
    results.push({
      tierIndex: tier.index,
      sellPortionPct: tier.sellPortionPct,
      soldNative,
      pnlNative,
      fillPrice: input.entryPrice * (1 + fillChangePct / 100),
    });
    remainingSizeNative -= soldNative;
  }

  return results;
}
