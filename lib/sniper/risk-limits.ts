import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { sniperState, type Position, type SniperState, type Trade } from "@/lib/db/schema";
import { getSniperConfig, type SniperConfig } from "./config";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** The control/heartbeat row is a singleton — create it on first use. */
export async function getOrCreateSniperState(): Promise<SniperState | null> {
  const db = getDb();
  if (!db) return null;
  const [existing] = await db.select().from(sniperState).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(sniperState).values({}).returning();
  return created;
}

export async function recordHeartbeat(mode: "dry_run" | "live"): Promise<void> {
  const db = getDb();
  if (!db) return;
  const state = await getOrCreateSniperState();
  if (!state) return;
  await db
    .update(sniperState)
    .set({ lastHeartbeatAt: new Date(), mode })
    .where(eq(sniperState.id, state.id));
}

/**
 * `allOpenPositions` must be the wallet's FULL open-position list (every
 * chain) — `maxConcurrentPositions` is a single wallet-global cap.
 *
 * `solanaOpenPositions` must be pre-filtered to Solana rows only (chain
 * IS NULL, for legacy pre-PR04 history, or chain = "solana") — the
 * deployed-SOL sum below reads ONLY these. A Robinhood row's `sizeSol`
 * is a compatibility shadow of its ETH notional (see
 * lib/sniper/positions.ts's OpenPositionInput doc comments), and summing
 * it here would silently count ETH exposure as SOL exposure. Callers
 * (see scripts/paper-daemon.ts) are responsible for passing the correct,
 * pre-filtered second list — this function does not re-derive it, to
 * keep the filtering logic in exactly one place
 * (lib/sniper/positions.ts#getOpenSolanaPositions).
 */
export function canOpenNewPosition(
  allOpenPositions: Pick<Position, "id">[],
  solanaOpenPositions: Pick<Position, "sizeSol">[],
  state: Pick<SniperState, "tradingPaused" | "pauseReason" | "lastLossAt"> | null,
  config: SniperConfig
): { allowed: boolean; reason?: string } {
  if (state?.tradingPaused) {
    return { allowed: false, reason: state.pauseReason ?? "trading paused" };
  }
  if (allOpenPositions.length >= config.maxConcurrentPositions) {
    return {
      allowed: false,
      reason: `max concurrent positions (${config.maxConcurrentPositions}) reached`,
    };
  }
  const totalDeployed = solanaOpenPositions.reduce(
    (sum, p) => sum + Number(p.sizeSol),
    0
  );
  if (totalDeployed + config.maxSolPerSnipe > config.maxTotalDeployedSol) {
    return {
      allowed: false,
      reason: `max total deployed SOL (${config.maxTotalDeployedSol}) would be exceeded`,
    };
  }
  if (config.cooldownAfterLossSec > 0 && state?.lastLossAt) {
    const elapsedSec = (Date.now() - state.lastLossAt.getTime()) / 1000;
    if (elapsedSec < config.cooldownAfterLossSec) {
      const remaining = Math.ceil(config.cooldownAfterLossSec - elapsedSec);
      return {
        allowed: false,
        reason: `cooldown after loss — ${remaining}s remaining`,
      };
    }
  }
  return { allowed: true };
}

export function sizeForSnipe(config: SniperConfig): number {
  return config.maxSolPerSnipe;
}

/**
 * Called after every closed trade (win or loss). Trips the circuit breaker
 * — pausing without requiring a daemon restart — when consecutive losses
 * or daily drawdown exceed configured thresholds.
 */
export async function recordTradeOutcome(pnlSol: number): Promise<void> {
  const db = getDb();
  if (!db) return;
  const state = await getOrCreateSniperState();
  if (!state) return;
  const config = await getSniperConfig();

  const now = new Date();
  const dayRolledOver = now.getTime() - state.dailyPnlResetAt.getTime() > ONE_DAY_MS;

  const dailyPnlSol = (dayRolledOver ? 0 : Number(state.dailyPnlSol)) + pnlSol;
  const consecutiveLosses = pnlSol < 0 ? Number(state.consecutiveLosses) + 1 : 0;

  const updates: Partial<typeof sniperState.$inferInsert> = {
    dailyPnlSol: String(dailyPnlSol),
    dailyPnlResetAt: dayRolledOver ? now : state.dailyPnlResetAt,
    consecutiveLosses: String(consecutiveLosses),
    lastLossAt: pnlSol < 0 ? now : state.lastLossAt,
  };

  if (consecutiveLosses >= config.maxConsecutiveLosses) {
    updates.tradingPaused = true;
    updates.pauseReason = `${consecutiveLosses} consecutive losses (limit ${config.maxConsecutiveLosses})`;
  }
  if (dailyPnlSol <= -config.maxDailyDrawdownSol) {
    updates.tradingPaused = true;
    updates.pauseReason = `daily drawdown ${dailyPnlSol.toFixed(3)} SOL exceeded limit ${config.maxDailyDrawdownSol}`;
  }

  await db.update(sniperState).set(updates).where(eq(sniperState.id, state.id));
}

export async function setPaused(paused: boolean, reason?: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const state = await getOrCreateSniperState();
  if (!state) return;
  await db
    .update(sniperState)
    .set({
      tradingPaused: paused,
      pauseReason: paused ? (reason ?? "manually paused") : null,
    })
    .where(eq(sniperState.id, state.id));
}

export type DerivedTradeStats = {
  /** Closed trades for one wallet, most recent first (see
   * lib/sniper/wallet-trade-stats.ts#getRecentOutcomes). */
  recentOutcomes: Pick<Trade, "pnlSol" | "closedAt">[];
  dailyPnlSol: number;
  lastLossAt: Date | null;
};

/**
 * Per-user circuit breaker, re-derived fresh every call from that wallet's
 * own trades — deliberately NOT persisted/sticky like sniper_state's
 * tradingPaused. The house breaker never auto-clears (only a manual
 * /api/sniper/toggle call resets it); doing the same per-user with no
 * per-user pause UI in scope would mean a bot could permanently stop
 * trading after a bad streak with no way for its owner to know or fix it.
 * This trips on exactly the same conditions (consecutive losses, daily
 * drawdown) the house's recordTradeOutcome does, but self-heals the moment
 * the underlying trades no longer breach them.
 */
/** How long a quiet period must be before a losing streak stops counting,
 * and how long a consecutive-loss pause lasts. Chosen to outlast the market
 * condition that caused the streak without costing the agent a whole day;
 * it is deliberately much longer than the 300s position hold cap. */
export const STREAK_RESET_MS = 30 * 60 * 1000;

export function deriveTradingPause(
  stats: DerivedTradeStats,
  config: Pick<SniperConfig, "maxConsecutiveLosses" | "maxDailyDrawdownSol">
): Pick<SniperState, "tradingPaused" | "pauseReason" | "lastLossAt"> {
  /* A streak is broken by a win, by a break-even trade, or by time.
   *
   * The time clause is what makes this breaker self-healing, and it is not
   * cosmetic. Without it a pause that expires only re-arms: the streak is
   * still in history, so the very next loss puts the agent straight back
   * over the limit and it pauses after every single trade from then on.
   * Treating a quiet gap as the end of a streak means the pause genuinely
   * ends, and it needs no stored flag and no manual reset.
   *
   * The deeper reason this breaker has to be forgiving: this strategy is
   * designed around a low win rate with asymmetric payoff (§16.2), so
   * losing runs are the normal state, not evidence of a fault. Measured on
   * live paper data at a 22% win rate, a limit of 2 tripped once every 3.1
   * trades, which left agents paused essentially always. Capital harm is
   * bounded by the daily drawdown limit below, which measures what actually
   * matters; this counter only exists to catch a pathological run. */
  let consecutiveLosses = 0;
  let previousClosedAt: Date | null = null;
  for (const trade of stats.recentOutcomes) {
    if (Number(trade.pnlSol) >= 0) break;
    if (
      previousClosedAt != null &&
      previousClosedAt.getTime() - trade.closedAt.getTime() > STREAK_RESET_MS
    ) {
      break;
    }
    consecutiveLosses++;
    previousClosedAt = trade.closedAt;
  }

  /* The pause itself also expires: once nothing has been lost for the
     cooldown, the agent resumes on its own. */
  const streakIsCurrent =
    stats.lastLossAt != null &&
    Date.now() - stats.lastLossAt.getTime() <= STREAK_RESET_MS;

  if (consecutiveLosses >= config.maxConsecutiveLosses && streakIsCurrent) {
    return {
      tradingPaused: true,
      pauseReason: `${consecutiveLosses} consecutive losses (limit ${config.maxConsecutiveLosses})`,
      lastLossAt: stats.lastLossAt,
    };
  }
  if (stats.dailyPnlSol <= -config.maxDailyDrawdownSol) {
    return {
      tradingPaused: true,
      pauseReason: `daily drawdown ${stats.dailyPnlSol.toFixed(3)} SOL exceeded limit ${config.maxDailyDrawdownSol}`,
      lastLossAt: stats.lastLossAt,
    };
  }
  return { tradingPaused: false, pauseReason: null, lastLossAt: stats.lastLossAt };
}
