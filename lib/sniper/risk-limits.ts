import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { sniperState, type Position, type SniperState } from "@/lib/db/schema";
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

export function canOpenNewPosition(
  openPositions: Position[],
  state: SniperState | null,
  config: SniperConfig
): { allowed: boolean; reason?: string } {
  if (state?.tradingPaused) {
    return { allowed: false, reason: state.pauseReason ?? "trading paused" };
  }
  if (openPositions.length >= config.maxConcurrentPositions) {
    return {
      allowed: false,
      reason: `max concurrent positions (${config.maxConcurrentPositions}) reached`,
    };
  }
  const totalDeployed = openPositions.reduce(
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
