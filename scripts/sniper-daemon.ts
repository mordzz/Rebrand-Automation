// Standalone long-running process — deliberately NOT a Next.js API route.
// Run via `npm run sniper` (dev) or under pm2 for real operation. Trading
// behavior (sizing, entry filters, exit strategy) lives in the sniper_config
// DB row and is re-read every cycle (lib/sniper/config.ts#getSniperConfig) —
// change it from the dashboard or via PATCH /api/sniper/config and it takes
// effect without a restart. SNIPER_ENABLED/SNIPER_DRY_RUN stay in .env,
// checked once at startup — deliberate master switches, not tuning knobs.
// Coordinates with the dashboard only through the shared Postgres database
// (positions, sniper_state, sniper_config) — see lib/sniper/* and
// lib/db/schema.ts.
import "dotenv/config";

import { getDb } from "@/lib/db";
import type { Position } from "@/lib/db/schema";
import { writeLog, type LogLevel } from "@/lib/logs";
import { getWalletAddress, signAndSendRawTransaction } from "@/lib/solana/wallet";
import {
  buildTradeLocalTx,
  subscribeNewTokenStream,
  type PumpPortalNewTokenEvent,
} from "@/lib/solana/pumpportal";
import {
  getSniperConfig,
  loadSniperRuntimeFlags,
  type SniperConfig,
} from "@/lib/sniper/config";
import { getCurrentPrice } from "@/lib/sniper/exit-price";
import {
  closePosition,
  getOpenPositions,
  markPositionClosed,
  openPosition,
  recordPartialExit,
  updatePositionPrice,
} from "@/lib/sniper/positions";
import {
  canOpenNewPosition,
  getOrCreateSniperState,
  recordHeartbeat,
  recordTradeOutcome,
  sizeForSnipe,
} from "@/lib/sniper/risk-limits";
import { passesAll } from "@/lib/sniper/safety-checks";

const HEARTBEAT_INTERVAL_MS = 5_000;
// How often the pending-token queue is drained (see below) — a poll-rate
// implementation detail, not a trading knob, so it's a constant rather than
// a sniper_config field.
const QUEUE_DRAIN_INTERVAL_MS = 1_000;
const MAX_PENDING_QUEUE = 500;
// Below this remaining SOL, treat a tiered position as fully exited rather
// than leaving a dust-sized "open" row behind.
const DUST_THRESHOLD_SOL = 1e-6;
// Deliberately aggressive-but-bounded — sniping needs to land fast, but a
// runaway priority fee on a bot with no per-trade human check is its own
// risk. Not exposed as an env var in v1; revisit if real usage shows it
// needs tuning.
const PRIORITY_FEE_SOL = 0.0002;
const SLIPPAGE_PCT = 15;

function log(...args: unknown[]) {
  console.log(`[sniper ${new Date().toISOString()}]`, ...args);
}

/**
 * Console output plus a real, curated row in the `logs` table for the
 * dashboard's execution terminal — deliberately only called for
 * trade-lifecycle events, not every evaluated-and-skipped token (see
 * lib/logs.ts).
 */
function record(level: LogLevel, message: string, txSignature?: string) {
  log(message);
  void writeLog({ level, message, txSignature, source: "sniper" });
}

type PositionContext = {
  dryRun?: boolean;
  triggeredTiers?: number[];
};

async function handleNewToken(
  event: PumpPortalNewTokenEvent,
  config: SniperConfig,
  ageSec: number
): Promise<void> {
  const safety = await passesAll(event, config, ageSec);
  if (!safety.passed) {
    log(`SKIP ${event.symbol} (${event.mint}): ${safety.reasons.join("; ")}`);
    return;
  }

  const [state, openPositions] = await Promise.all([
    getOrCreateSniperState(),
    getOpenPositions(),
  ]);
  const risk = canOpenNewPosition(openPositions, state, config);
  if (!risk.allowed) {
    log(`SKIP ${event.symbol} (${event.mint}): ${risk.reason}`);
    return;
  }

  const sizeSol = sizeForSnipe(config);
  // Approximation: price implied by the bonding-curve reserves at the
  // moment of the create event, before our own buy moves it. Good enough
  // for v1 P&L tracking given exits are already evaluated against
  // DexScreener's independently-polled price, not this figure.
  const entryPrice = event.vSolInBondingCurve / event.vTokensInBondingCurve;

  if (config.exitMode === "tiered" && config.takeProfitTiers.length === 0) {
    log(
      `WARNING: exitMode is "tiered" but no takeProfitTiers configured for ${event.symbol} — falling back to fixed take-profit for this snipe.`
    );
  }

  const runtimeFlags = loadSniperRuntimeFlags();

  if (runtimeFlags.dryRun) {
    record(
      "buy",
      `DRY RUN buy — ${sizeSol} SOL of ${event.symbol} (${event.mint}) @ ~${entryPrice.toExponential(3)} SOL/token`
    );
    await openPosition({
      token: event.mint,
      symbol: event.symbol,
      entryPrice,
      sizeSol,
      takeProfitPct: config.takeProfitPct,
      stopLossPct: config.stopLossPct,
      entryTxSignature: "dry-run",
      context: { dryRun: true, safety } satisfies PositionContext & Record<string, unknown>,
    });
    return;
  }

  try {
    const walletAddress = await getWalletAddress();
    if (!walletAddress) throw new Error("PRIVATE_KEY_SOLANA_WALLET not configured");

    const unsignedTx = await buildTradeLocalTx({
      publicKey: walletAddress,
      action: "buy",
      mint: event.mint,
      amount: sizeSol,
      denominatedInSol: true,
      slippage: SLIPPAGE_PCT,
      priorityFee: PRIORITY_FEE_SOL,
      pool: "pump",
    });
    const signature = await signAndSendRawTransaction(unsignedTx);
    record(
      "buy",
      `BOUGHT ${event.symbol} (${event.mint}) for ${sizeSol} SOL`,
      signature
    );

    await openPosition({
      token: event.mint,
      symbol: event.symbol,
      entryPrice,
      sizeSol,
      takeProfitPct: config.takeProfitPct,
      stopLossPct: config.stopLossPct,
      entryTxSignature: signature,
      context: { dryRun: false, safety },
    });
  } catch (error) {
    record(
      "error",
      `BUY FAILED for ${event.symbol} (${event.mint}): ${error instanceof Error ? error.message : error}`
    );
  }
}

/** Sells `portionPct` of whatever token balance remains (dry-run: logged
 * only). Shared by the full-exit path (portionPct=100) and each tiered
 * take-profit tranche. */
async function executeSell(
  position: Position,
  portionPct: number,
  isDryRun: boolean
): Promise<string> {
  if (isDryRun) return "dry-run";
  const walletAddress = await getWalletAddress();
  if (!walletAddress) throw new Error("PRIVATE_KEY_SOLANA_WALLET not configured");
  const unsignedTx = await buildTradeLocalTx({
    publicKey: walletAddress,
    action: "sell",
    mint: position.token,
    amount: `${portionPct}%`,
    denominatedInSol: false,
    slippage: SLIPPAGE_PCT,
    priorityFee: PRIORITY_FEE_SOL,
    pool: "pump",
  });
  return signAndSendRawTransaction(unsignedTx);
}

async function checkExits(config: SniperConfig): Promise<void> {
  const openPositions = await getOpenPositions();

  for (const position of openPositions) {
    const currentPrice = await getCurrentPrice(position.token);
    if (currentPrice == null) continue;

    const entryPrice = Number(position.entryPrice);
    const previousPrice = position.lastPrice != null ? Number(position.lastPrice) : null;
    const changePct = ((currentPrice - entryPrice) / entryPrice) * 100;
    const isDryRun = (position.context as PositionContext | null)?.dryRun === true;

    // Trailing-stop / breakeven-lock share one "highest price ever seen"
    // watermark — tracked whenever either feature is enabled, from open,
    // not just after crossing an activation threshold, so "once armed,
    // stays armed" survives a price pullback.
    const trackPeak = config.trailingStopEnabled || config.breakevenAfterPct != null;
    let peakPrice = position.peakPrice != null ? Number(position.peakPrice) : null;
    if (trackPeak && (peakPrice == null || currentPrice > peakPrice)) {
      peakPrice = currentPrice;
    }
    const peakChangePct =
      trackPeak && peakPrice != null ? ((peakPrice - entryPrice) / entryPrice) * 100 : changePct;

    await updatePositionPrice(position.id, currentPrice, trackPeak ? peakPrice ?? currentPrice : undefined);

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

    const holdSec = (Date.now() - position.openedAt.getTime()) / 1000;
    const shouldTimeExit =
      config.maxHoldTimeSec != null && holdSec >= config.maxHoldTimeSec;

    const trailingArmed =
      config.trailingStopEnabled && peakChangePct >= config.trailingStopActivationPct;
    const shouldTrailingExit =
      trailingArmed &&
      peakPrice != null &&
      ((peakPrice - currentPrice) / peakPrice) * 100 >= config.trailingStopPct;

    // Once price has ever reached breakevenAfterPct, the stop floor moves
    // up to entry price (0%) instead of the configured stop-loss distance —
    // this guarantees no loss from that point on, at the cost of a smaller
    // worst-case exit than letting the full stop-loss run.
    const breakevenActive =
      config.breakevenAfterPct != null && peakChangePct >= config.breakevenAfterPct;
    const effectiveStopLossPct = breakevenActive ? 0 : config.stopLossPct;
    const shouldStopLoss = changePct <= -effectiveStopLossPct;

    // The flat take-profit target only drives a full exit in "fixed" mode —
    // in "tiered" mode, profit-taking is handled by the ladder below, while
    // stop-loss/trailing/crash/time-exit still apply as a safety net either way.
    const shouldFixedTakeProfit = config.exitMode === "fixed" && changePct >= config.takeProfitPct;

    const shouldFullExit =
      shouldCrashExit || shouldTimeExit || shouldTrailingExit || shouldStopLoss || shouldFixedTakeProfit;

    if (shouldFullExit) {
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

      const pnlSol = Number(position.sizeSol) * (changePct / 100);
      // guard = took profit on purpose; warn = a fast-out crash exit
      // (urgent); sell = realized at or below cost.
      const exitLevel: LogLevel = shouldCrashExit ? "warn" : pnlSol >= 0 ? "guard" : "sell";

      if (isDryRun) {
        record(
          exitLevel,
          `DRY RUN ${reason} — ${position.symbol} (${position.token}) at ${changePct.toFixed(1)}% (pnl ${pnlSol.toFixed(4)} SOL)`
        );
        await closePosition(position, {
          exitPrice: currentPrice,
          exitTxSignature: "dry-run",
          pnlSol,
          reason,
        });
        await recordTradeOutcome(pnlSol);
        continue;
      }

      try {
        const signature = await executeSell(position, 100, false);
        record(
          exitLevel,
          `SOLD (${reason}) ${position.symbol} (${position.token}) at ${changePct.toFixed(1)}%`,
          signature
        );
        await closePosition(position, {
          exitPrice: currentPrice,
          exitTxSignature: signature,
          pnlSol,
          reason,
        });
        await recordTradeOutcome(pnlSol);
      } catch (error) {
        record(
          "error",
          `SELL FAILED for ${position.symbol} (${position.token}): ${error instanceof Error ? error.message : error}`
        );
      }
      continue;
    }

    // Tiered take-profit ladder — only reached when no full-exit condition
    // fired above. Walks configured tiers ascending; each untriggered tier
    // whose atPct has been crossed sells sellPortionPct of the *currently
    // remaining* size, so a position can ladder through several tiers in
    // one tick if price gapped past more than one at once.
    if (config.exitMode === "tiered" && config.takeProfitTiers.length > 0) {
      const context = (position.context as PositionContext | null) ?? {};
      const triggeredTiers = context.triggeredTiers ?? [];
      const sortedTiers = config.takeProfitTiers
        .map((tier, index) => ({ ...tier, index }))
        .sort((a, b) => a.atPct - b.atPct);

      let remainingSizeSol = Number(position.sizeSol);
      let latestPosition = position;

      for (const tier of sortedTiers) {
        if (triggeredTiers.includes(tier.index)) continue;
        if (changePct < tier.atPct) continue;
        if (remainingSizeSol <= DUST_THRESHOLD_SOL) break;

        const soldSol = remainingSizeSol * (tier.sellPortionPct / 100);
        const tranchePnl = soldSol * (changePct / 100);

        let signature: string;
        try {
          signature = await executeSell(latestPosition, tier.sellPortionPct, isDryRun);
        } catch (error) {
          record(
            "error",
            `TIER SELL FAILED for ${position.symbol} (${position.token}) tier ${tier.index}: ${error instanceof Error ? error.message : error}`
          );
          break;
        }

        record(
          "guard",
          `${isDryRun ? "DRY RUN " : ""}tiered take-profit tier ${tier.index} — ${position.symbol} (${position.token}) sold ${tier.sellPortionPct}% of remainder at ${changePct.toFixed(1)}% (pnl ${tranchePnl.toFixed(4)} SOL)`,
          signature === "dry-run" ? undefined : signature
        );

        await recordPartialExit(latestPosition, {
          soldSol,
          exitPrice: currentPrice,
          exitTxSignature: signature,
          pnlSol: tranchePnl,
          tierIndex: tier.index,
        });
        await recordTradeOutcome(tranchePnl);

        triggeredTiers.push(tier.index);
        remainingSizeSol -= soldSol;
        latestPosition = {
          ...latestPosition,
          sizeSol: String(remainingSizeSol),
          context: { ...context, triggeredTiers },
        };

        if (remainingSizeSol <= DUST_THRESHOLD_SOL) {
          await markPositionClosed(position.id);
          break;
        }
      }
    }
  }
}

async function main(): Promise<void> {
  const flags = loadSniperRuntimeFlags();
  if (!flags.enabled) {
    log('SNIPER_ENABLED is not "true" — exiting without starting. Set it in .env to run the daemon.');
    process.exit(0);
  }

  if (!getDb()) {
    log(
      "WARNING: DATABASE_URL/DIRECT_URL not configured — the daemon will detect and log, but cannot track positions, enforce concurrent-position limits, or run the exit loop meaningfully. Set these up before going live."
    );
  }

  record("info", `Sniper daemon starting in ${flags.dryRun ? "DRY RUN" : "LIVE"} mode.`);
  const initialConfig = await getSniperConfig();
  log("Initial config:", initialConfig);
  if (initialConfig.requireAlphaWalletBuy && initialConfig.alphaWallets.length === 0) {
    log(
      "WARNING: requireAlphaWalletBuy is on but alphaWallets is empty — this filter is a no-op until wallet addresses are added."
    );
  }

  const mode = flags.dryRun ? "dry_run" : "live";
  await recordHeartbeat(mode);
  const heartbeatTimer = setInterval(() => {
    recordHeartbeat(mode).catch((error) => log("heartbeat error", error));
  }, HEARTBEAT_INTERVAL_MS);

  // Self-rescheduling rather than setInterval so exitCheckIntervalMs can
  // itself be changed live from sniper_config without a restart.
  let exitTimer: ReturnType<typeof setTimeout> | null = null;
  async function scheduleExitCheck() {
    const config = await getSniperConfig();
    await checkExits(config).catch((error) => log("exit-check error", error));
    exitTimer = setTimeout(scheduleExitCheck, config.exitCheckIntervalMs);
  }
  void scheduleExitCheck();

  // New tokens are queued with a receipt timestamp rather than evaluated
  // immediately, so minTokenAgeSec (a deliberate delayed-entry option) can
  // be honored — PumpPortal's create event carries no timestamp of its own
  // (confirmed live), so age is measured from when we first observed it.
  const pendingTokens: { event: PumpPortalNewTokenEvent; receivedAt: number }[] = [];
  let queueTimer: ReturnType<typeof setTimeout> | null = null;
  async function scheduleQueueDrain() {
    if (pendingTokens.length > 0) {
      const config = await getSniperConfig();
      const now = Date.now();
      const ready: typeof pendingTokens = [];
      const stillWaiting: typeof pendingTokens = [];
      for (const item of pendingTokens) {
        const ageSec = (now - item.receivedAt) / 1000;
        if (ageSec >= config.minTokenAgeSec) ready.push(item);
        else stillWaiting.push(item);
      }
      pendingTokens.length = 0;
      pendingTokens.push(...stillWaiting);

      for (const item of ready) {
        const ageSec = (Date.now() - item.receivedAt) / 1000;
        handleNewToken(item.event, config, ageSec).catch((error) =>
          log("handleNewToken error", error)
        );
      }
    }
    queueTimer = setTimeout(scheduleQueueDrain, QUEUE_DRAIN_INTERVAL_MS);
  }
  void scheduleQueueDrain();

  const unsubscribe = subscribeNewTokenStream(
    (event) => {
      pendingTokens.push({ event, receivedAt: Date.now() });
      if (pendingTokens.length > MAX_PENDING_QUEUE) pendingTokens.shift();
    },
    (message) => log(message)
  );

  // Async so the shutdown log actually has a chance to reach the DB before
  // process.exit() cuts off pending I/O — record()'s fire-and-forget write
  // wouldn't reliably land otherwise.
  async function shutdown() {
    log("Shutting down...");
    await writeLog({
      level: "info",
      message: "Sniper daemon shutting down.",
      source: "sniper",
    }).catch(() => {});
    clearInterval(heartbeatTimer);
    if (exitTimer) clearTimeout(exitTimer);
    if (queueTimer) clearTimeout(queueTimer);
    unsubscribe();
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  log("Fatal error:", error);
  process.exit(1);
});
