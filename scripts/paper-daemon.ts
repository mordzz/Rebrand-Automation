// Standalone long-running process — deliberately NOT a Next.js API route,
// same shape as scripts/sniper-daemon.ts. Run via `npm run paper`.
//
// Simulates trades for every deployed bot in user_bots against its own
// effective config (house base + saved overlay), writing real positions/
// trades rows scoped to that bot's wallet address — the same schema the
// house desk uses, just with walletAddress set instead of null (see the
// "null = house desk" convention documented on lib/db/schema.ts#trades).
//
// This process is structurally incapable of moving real funds: it never
// imports lib/solana/wallet.ts's signing helpers or reads
// PRIVATE_KEY_SOLANA_WALLET. Every entry/exit signature is the literal
// string "paper". Trading behavior is per-user config
// (lib/sniper/effective-config.ts#getEffectiveConfig), re-read on a
// roster refresh interval — no restart needed for a user's config change
// to take effect.
//
// Circuit-breaker state (consecutive losses, daily drawdown) is derived
// fresh from each wallet's own trades every cycle rather than persisted —
// see lib/sniper/risk-limits.ts#deriveTradingPause for why.
//
// Second responsibility: every fresh mint is also evaluated once against
// the house's own Sniper config (independent of whether any bot is
// deployed) and, if it passes, recorded to alpha_candidates for the
// "Alpha" discovery page (app/alpha) — reusing the same already-fetched
// token safety data as the per-user evaluation above, not a second fetch.
import "dotenv/config";

import { and, eq, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { writeLog } from "@/lib/logs";
import { positions, userBots, type SniperState, type UserBot } from "@/lib/db/schema";
import { isGmgnConfigured } from "@/lib/gmgn/client";
import { getEffectiveConfig } from "@/lib/sniper/effective-config";
import { DUST_THRESHOLD_NATIVE, DUST_THRESHOLD_SOL, evaluateFullExit, evaluateTieredExits } from "@/lib/sniper/exit-logic";
import { getCurrentPrice } from "@/lib/sniper/exit-price";
import {
  closePosition,
  getOpenPositions,
  markPositionClosed,
  openPosition,
  recordPartialExit,
  updatePositionPrice,
} from "@/lib/sniper/positions";
import type { SniperConfig } from "@/lib/sniper/config";

// ── PR07: Robinhood Chain paper trading ─────────────────────────────────
// Read-only discovery/security/safety/price adapters and chain-scoped
// risk helpers only — no swap, no signing, no Solana/Jupiter/EVM
// execution code is imported below. See openRobinhoodPaperPosition and
// the ROBINHOOD-PAPER-ONLY markers further down for the structural
// boundary this relies on.
import { discoverRobinhoodTokens, type RobinhoodDiscoveredToken } from "@/lib/gmgn/discovery-robinhood";
import { getRobinhoodTokenSecurity } from "@/lib/gmgn/security-robinhood";
import type { RobinhoodSecurityFacts } from "@/lib/gmgn/security-robinhood";
import { evaluateRobinhoodSafety, type RobinhoodSafetyCheckResult } from "@/lib/gmgn/safety-robinhood";
import { getRobinhoodTokenPriceUsd } from "@/lib/gmgn/price-robinhood";
import { ROBINHOOD_NETWORK } from "@/lib/chain/config";
import {
  canOpenNewRobinhoodPosition,
  deriveRobinhoodTradingPause,
  resolveRobinhoodNativeLimits,
  sizeForRobinhoodSnipe,
  type RobinhoodNativeLimits,
} from "@/lib/sniper/risk-limits-robinhood";
import { getOpenPositionsByChain } from "@/lib/sniper/positions";
import {
  getDailyPnlNativeRobinhood,
  getLastLossAtRobinhood,
  getRecentRobinhoodOutcomes,
} from "@/lib/sniper/wallet-trade-stats-robinhood";

const ROSTER_REFRESH_INTERVAL_MS = 20_000;
// A token stays in the pending queue until every active bot has had one
// evaluation attempt against it (respecting that bot's own minTokenAgeSec),
// or until it's aged out entirely — whichever comes first.
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;
const MIN_EXIT_CHECK_INTERVAL_MS = 2000;
const DEFAULT_EXIT_CHECK_INTERVAL_MS = 4000;
// Circuit-breaker state is re-derived from the trades table (see
// lib/sniper/wallet-trade-stats.ts) rather than persisted — cache briefly
// so a burst of pending-token evaluations for the same wallet doesn't
// re-run three DB queries per token.
const BREAKER_CACHE_TTL_MS = 8_000;

function log(...args: unknown[]) {
  console.log(`[paper ${new Date().toISOString()}]`, ...args);
}

function short(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

type RosterEntry = { bot: UserBot; config: SniperConfig };
let roster: RosterEntry[] = [];

async function refreshRoster(): Promise<void> {
  const db = getDb();
  if (!db) {
    roster = [];
    return;
  }
  const bots = await db.select().from(userBots);
  roster = await Promise.all(
    bots.map(async (bot) => ({ bot, config: await getEffectiveConfig(bot) }))
  );
}

type BreakerState = Pick<SniperState, "tradingPaused" | "pauseReason" | "lastLossAt">;
const breakerCache = new Map<string, { state: BreakerState; expiresAt: number }>();

function invalidateBreakerCache(wallet: string): void {
  breakerCache.delete(wallet);
}

// Serializes the risk-check-then-write critical section per wallet.
// Different pending tokens are evaluated concurrently (scheduleQueueDrain
// fires processPendingToken for every queued item without awaiting between
// them), so two distinct tokens passing safety for the same wallet at
// nearly the same time would otherwise both read the same pre-write
// getOpenPositions() snapshot, both pass canOpenNewPosition, and both
// write — a classic TOCTOU race that silently blows through
// maxConcurrentPositions/maxTotalDeployedSol (observed live: one wallet
// opened 5 positions against a configured cap of 2). Different wallets
// never block each other.
const walletQueues = new Map<string, Promise<unknown>>();
function runExclusive<T>(wallet: string, fn: () => Promise<T>): Promise<T> {
  const prior = walletQueues.get(wallet) ?? Promise.resolve();
  const result = prior.then(fn, fn);
  walletQueues.set(
    wallet,
    result.catch(() => undefined)
  );
  return result;
}


/** A vetted Robinhood entry candidate — PR07. Structurally separate from
 * the retired Solana entry candidate (PR09A). Only ever passed to
 * openRobinhoodPaperPosition. */
type RobinhoodEntryCandidate = {
  chain: "robinhood";
  tokenAddress: string;
  symbol: string | undefined;
  network: typeof ROBINHOOD_NETWORK;
  /** USD per token — see lib/gmgn/price-robinhood.ts for the field and
   * evidence. Both entry and current price come from that same source,
   * so entryPriceUnit === currentPriceUnit holds by construction. */
  entryPrice: number;
  priceUnit: "usd_per_token";
  safety: RobinhoodSafetyCheckResult;
  source: "gmgn";
  launchpad: string | null;
};


// ══════════════════════════════════════════════════════════════════════
// ROBINHOOD-PAPER-ONLY-START
//
// Everything from here to ROBINHOOD-PAPER-ONLY-END handles Robinhood
// candidates and Robinhood open positions. It is structurally incapable
// of moving real funds: this file imports no Jupiter/swap/execution code
// for Robinhood at all (see the PR07 import block near the top), no EVM
// signing library, no private key of any kind. A Robinhood candidate is
// ALWAYS recorded with dryRun:true / engine:"paper" / chain:"robinhood",
// even for a bot whose tradingMode is "live" — bot.tradingMode is never
// read anywhere in this block. PR08 (swap/execution) and PR09
// (autonomous EVM signing) are explicitly out of scope; implementing
// either here would be exactly the "Robinhood live fallback" this PR
// must not create.
// scripts/test-robinhood-paper-trading.ts statically greps this file for
// forbidden swap/signing/Solana-RPC identifiers, so this boundary is
// regression-tested, not just documented.
// ══════════════════════════════════════════════════════════════════════

/** Per-wallet Robinhood-only breaker cache — deliberately separate from
 * `breakerCache` above (which is Solana-scoped, reading pnlSol/
 * maxDailyDrawdownSol). Keeps a wallet's Robinhood ETH circuit breaker
 * fully independent of its Solana SOL one; never merged, never summed. */
const robinhoodBreakerCache = new Map<
  string,
  { state: Pick<SniperState, "tradingPaused" | "pauseReason" | "lastLossAt">; expiresAt: number }
>();

function invalidateRobinhoodBreakerCache(wallet: string): void {
  robinhoodBreakerCache.delete(wallet);
}

async function getCachedRobinhoodBreakerState(
  wallet: string,
  breakerResetAt: Date | null,
  config: Pick<SniperConfig, "maxConsecutiveLosses">,
  limits: RobinhoodNativeLimits
): Promise<Pick<SniperState, "tradingPaused" | "pauseReason" | "lastLossAt">> {
  const cached = robinhoodBreakerCache.get(wallet);
  if (cached && cached.expiresAt > Date.now()) return cached.state;

  const [recentOutcomes, dailyPnlNative, lastLossAt] = await Promise.all([
    getRecentRobinhoodOutcomes(wallet, 50, breakerResetAt),
    getDailyPnlNativeRobinhood(wallet, breakerResetAt),
    getLastLossAtRobinhood(wallet, breakerResetAt),
  ]);
  const state = deriveRobinhoodTradingPause(
    {
      recentOutcomes: recentOutcomes.map((t) => ({ pnlNative: t.pnlNative, closedAt: t.closedAt })),
      dailyPnlNative,
      lastLossAt,
    },
    config,
    limits
  );
  robinhoodBreakerCache.set(wallet, { state, expiresAt: Date.now() + BREAKER_CACHE_TTL_MS });
  return state;
}

/**
 * Opens a Robinhood paper position — always a simulation, regardless of
 * bot.tradingMode. No round-trip sell check (no DEX router integration
 * exists yet — that's PR08), no live-execution branch at all.
 */
async function openRobinhoodPaperPosition(
  bot: UserBot,
  config: SniperConfig,
  candidate: RobinhoodEntryCandidate
): Promise<void> {
  await runExclusive(bot.walletAddress, async () => {
    const limitsResult = resolveRobinhoodNativeLimits(config);
    if (!limitsResult.ok) {
      logRobinhoodRefusal(bot, candidate.tokenAddress, candidate.symbol, "robinhood", candidate.network, [
        limitsResult.reason,
      ]);
      return;
    }
    const limits = limitsResult.limits;

    const [allOpenPositions, robinhoodOpenPositions, breakerState] = await Promise.all([
      // Wallet-global, ALL chains — maxConcurrentPositions keeps its
      // existing single meaning, unchanged by this PR.
      getOpenPositions(bot.walletAddress),
      // Chain-scoped — the deployed-native sum below must never include
      // a Solana sizeSol figure.
      getOpenPositionsByChain(bot.walletAddress, "robinhood"),
      getCachedRobinhoodBreakerState(bot.walletAddress, bot.breakerResetAt, config, limits),
    ]);

    const risk = canOpenNewRobinhoodPosition(allOpenPositions, robinhoodOpenPositions, breakerState, limits, config);
    if (!risk.allowed) {
      if (risk.reason) {
        logRobinhoodRefusal(bot, candidate.tokenAddress, candidate.symbol, "robinhood", candidate.network, [
          risk.reason,
        ]);
      }
      return;
    }

    const sizeNative = sizeForRobinhoodSnipe(limits);

    log(
      `PAPER buy (Robinhood) — ${bot.name} (${short(bot.walletAddress)}): ${sizeNative} ${limits.nativeSymbol} of ${candidate.symbol} via ${candidate.launchpad ?? "gmgn"} (${candidate.tokenAddress}) @ ~${candidate.entryPrice} USD/token`
    );
    void writeLog({
      level: "buy",
      source: "paper",
      walletAddress: bot.walletAddress,
      tokenAddress: candidate.tokenAddress,
      chain: "robinhood",
      network: candidate.network,
      message: `Bought ${sizeNative} ${limits.nativeSymbol} of $${candidate.symbol ?? "?"} via ${candidate.launchpad ?? "gmgn"} at ${candidate.entryPrice} USD (Robinhood paper)`,
    });

    await openPosition({
      // Legacy NOT NULL compatibility shadows — see OpenPositionInput's
      // doc comments in lib/sniper/positions.ts. Never read for any
      // Robinhood decision; tokenAddress/sizeNative below are.
      token: candidate.tokenAddress,
      sizeSol: sizeNative,
      entryTxSignature: "paper",
      symbol: candidate.symbol,
      entryPrice: candidate.entryPrice,
      takeProfitPct: config.takeProfitPct,
      stopLossPct: config.stopLossPct,
      tokenAddress: candidate.tokenAddress,
      sizeNative,
      nativeSymbol: limits.nativeSymbol,
      chain: "robinhood",
      network: candidate.network,
      entryTxHash: null,
      context: {
        dryRun: true,
        engine: "paper",
        chain: "robinhood",
        network: candidate.network,
        source: candidate.source,
        launchpad: candidate.launchpad,
        priceUnit: candidate.priceUnit,
        safety: candidate.safety,
      },
      walletAddress: bot.walletAddress,
    });
  });
}
// ROBINHOOD-PAPER-ONLY-END


/** Robinhood counterpart to logRefusal — writes tokenAddress/chain/
 * network instead of tokenMint, so an EVM `0x...` address is never
 * persisted into the Solana-shaped tokenMint column, and never loses
 * its chain/network. txHash stays null (a refusal never has a
 * transaction). */
function logRobinhoodRefusal(
  bot: UserBot,
  tokenAddress: string,
  symbol: string | undefined,
  source: string,
  network: string,
  reasons: string[]
): void {
  const reason = reasons[0] ?? "failed entry criteria";
  if (reason.startsWith("too old by the time it was evaluated")) return;
  void writeLog({
    level: "guard",
    source: "manifest",
    walletAddress: bot.walletAddress,
    tokenAddress,
    chain: "robinhood",
    network,
    txHash: null,
    message: `Refused $${symbol ?? "?"} (${source}): ${reason}`,
  });
}


/* When each wallet's positions were last evaluated.
 *
 * The loop below ticks at the tightest interval on the roster, but a bot
 * must only be evaluated on its *own* exitCheckIntervalMs. This is not
 * cosmetic: crashDropPct is defined as a drop "in one check", so checking
 * a bot every 3s when it asked for 30s turns its crash guard into a far
 * more sensitive stop than configured — and made one operator's setting
 * silently change every other operator's trading. */
const lastExitCheckAt = new Map<string, number>();

async function checkAllExits(): Promise<void> {
  const db = getDb();
  if (!db) return;

  const openPositions = await db
    .select()
    .from(positions)
    .where(and(eq(positions.status, "open"), isNotNull(positions.walletAddress)));
  if (openPositions.length === 0) return;

  const configByWallet = new Map(roster.map((r) => [r.bot.walletAddress, r.config] as const));
  /* Which wallets are due this tick, decided once up front. Deciding it
     inside the position loop would let the first position of a wallet
     stamp the clock and skip that wallet's remaining positions. */
  const tickStartedAt = Date.now();
  const dueWallets = new Set<string>();
  for (const { bot, config } of roster) {
    const dueAt =
      (lastExitCheckAt.get(bot.walletAddress) ?? 0) + config.exitCheckIntervalMs;
    if (tickStartedAt >= dueAt) {
      dueWallets.add(bot.walletAddress);
      lastExitCheckAt.set(bot.walletAddress, tickStartedAt);
    }
  }
  if (dueWallets.size === 0) return;

  const priceCache = new Map<string, Promise<number | null>>();
  /** `chain` picks the price source: Robinhood positions price against
   * GMGN's USD-per-token field (lib/gmgn/price-robinhood.ts), matching
   * the same source used at entry so entryPriceUnit === currentPriceUnit
   * holds. Everything else (chain null/"solana") is unchanged — priced
   * against DexScreener's SOL-denominated priceNative, as before. */
  function priceFor(token: string, chain: string | null): Promise<number | null> {
    const key = `${chain ?? "solana"}:${token}`;
    let cached = priceCache.get(key);
    if (!cached) {
      cached =
        chain === "robinhood"
          ? getRobinhoodTokenPriceUsd(token).then((r) => (r.ok ? r.priceUsd : null))
          : getCurrentPrice(token);
      priceCache.set(key, cached);
    }
    return cached;
  }

  for (const position of openPositions) {
    const walletAddress = position.walletAddress;
    if (!walletAddress) continue;
    const config = configByWallet.get(walletAddress);
    // Bot no longer in the roster (e.g. dropped between refreshes) — leave
    // the position untouched this tick rather than guessing at a config.
    if (!config) continue;

    // Honour this bot's own cadence, not the fleet's tightest.
    if (!dueWallets.has(walletAddress)) continue;

    const isRobinhood = position.chain === "robinhood";
    // ROBINHOOD-PAPER-ONLY: token/current-price lookup for a Robinhood
    // position uses GMGN's USD-per-token adapter (see priceFor above),
    // never DexScreener/Jupiter/a Solana RPC. `position.tokenAddress`
    // is the EVM address; `position.token` (legacy) holds the same
    // value as a compatibility shadow (see positions.ts), so either
    // works here, but tokenAddress is used to keep intent explicit.
    const currentPrice = await priceFor(
      isRobinhood ? (position.tokenAddress ?? position.token) : position.token,
      position.chain
    );
    if (currentPrice == null) continue;

    const entryPrice = Number(position.entryPrice);
    // For a Robinhood position this is the ETH notional (sizeNative),
    // stored in sizeSol only as the legacy NOT-NULL compatibility shadow
    // — both hold the same number, so reading either is equivalent, but
    // sizeNative is read here to keep the Robinhood risk figure explicit
    // and never silently mixed with a Solana SOL amount.
    const sizeSol = isRobinhood
      ? Number(position.sizeNative ?? position.sizeSol)
      : Number(position.sizeSol);

    /* A position opened with real money has to be closed with a real
       sale, whole or in tiers. Gated on the position itself, not the bot's
       current mode: switching a bot back to paper must not strand a live
       position with no way out.
       ROBINHOOD-PAPER-ONLY: liveBot is unconditionally null for a
       Robinhood position — no round-trip through positionContext.engine
       is possible, since openRobinhoodPaperPosition only ever writes
       engine:"paper". This is a second, independent guarantee beyond
       "PR07 never writes engine:'live' for Robinhood": even if that
       invariant were ever violated by a bug, this line still forces the
       paper-only exit path for every chain="robinhood" row. */
    const positionContext = (position.context ?? {}) as Record<string, unknown>;
    /* PR09A: the Solana live-execution runtime is retired. A historical
       Solana position opened with real money cannot be sold from here any
       more, and closing it on paper would book a fill that never happened,
       so it is left open and untouched (historical data preserved). */
    if (!isRobinhood && positionContext.engine === "live") continue;

    const decision = evaluateFullExit(
      {
        entryPrice,
        sizeSol,
        lastPrice: position.lastPrice != null ? Number(position.lastPrice) : null,
        peakPrice: position.peakPrice != null ? Number(position.peakPrice) : null,
        openedAt: position.openedAt,
      },
      config,
      currentPrice
    );

    await updatePositionPrice(position.id, currentPrice, decision.peakPrice ?? undefined);

    if (decision.exit) {
      const { reason, pnlSol } = decision;
      const exitTxSignature = "paper";
      /* The modelled fill, not the observed mark: a threshold exit is
         credited at its trigger (see evaluateFullExit). */
      const exitPrice = decision.fillPrice;

      if (isRobinhood) {
        log(
          `PAPER ${reason} (Robinhood) — ${position.symbol} (${position.tokenAddress ?? position.token}) wallet ${short(walletAddress)} pnl ${pnlSol.toFixed(6)} ${position.nativeSymbol ?? "ETH"}`
        );
        void writeLog({
          level: pnlSol >= 0 ? "sell" : "guard",
          source: "paper",
          walletAddress,
          tokenAddress: position.tokenAddress ?? position.token,
          chain: "robinhood",
          network: position.network,
          message: `${reason} on $${position.symbol ?? "?"}: ${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(6)} ${position.nativeSymbol ?? "ETH"} (Robinhood paper)`,
        });
      } else {
        log(
          `PAPER ${reason} — ${position.symbol} (${position.token}) wallet ${short(walletAddress)} pnl ${pnlSol.toFixed(4)} SOL`
        );
        void writeLog({
          level: pnlSol >= 0 ? "sell" : "guard",
          source: "paper",
          walletAddress,
          tokenMint: position.token,
          message: `${reason} on $${position.symbol ?? "?"}: ${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(4)} SOL`,
        });
      }

      await closePosition(position, {
        exitPrice,
        exitTxSignature,
        pnlSol,
        reason,
        ...(isRobinhood
          ? {
              sizeNative: Number(position.sizeNative ?? position.sizeSol),
              pnlNative: pnlSol,
              nativeSymbol: position.nativeSymbol ?? "ETH",
              chain: "robinhood",
              network: position.network,
              tokenAddress: position.tokenAddress ?? position.token,
            }
          : {}),
      });
      invalidateBreakerCache(walletAddress);
      if (isRobinhood) invalidateRobinhoodBreakerCache(walletAddress);
      continue;
    }

    const context = (position.context as { triggeredTiers?: number[] } | null) ?? {};
    const triggeredTiers = context.triggeredTiers ?? [];
    const tieredResults = evaluateTieredExits({ entryPrice, sizeSol, triggeredTiers }, config, currentPrice);

    let latestPosition = position;
    let remainingSizeSol = sizeSol;
    for (const tier of tieredResults) {
      const tierExitSignature = "paper";
      const tierExitPrice = tier.fillPrice;
      const tierPnlSol = tier.pnlSol;

      if (isRobinhood) {
        log(
          `PAPER tiered take-profit tier ${tier.tierIndex} (Robinhood) — ${position.symbol} (${position.tokenAddress ?? position.token}) wallet ${short(walletAddress)} sold ${tier.sellPortionPct}% pnl ${tier.pnlSol.toFixed(6)} ${position.nativeSymbol ?? "ETH"}`
        );
        void writeLog({
          level: "sell",
          source: "paper",
          walletAddress,
          tokenAddress: position.tokenAddress ?? position.token,
          chain: "robinhood",
          network: position.network,
          message: `Tier ${tier.tierIndex} take-profit on $${position.symbol ?? "?"}: sold ${tier.sellPortionPct}%, ${tier.pnlSol >= 0 ? "+" : ""}${tier.pnlSol.toFixed(6)} ${position.nativeSymbol ?? "ETH"} (Robinhood paper)`,
        });
      } else {
        log(
          `PAPER tiered take-profit tier ${tier.tierIndex} — ${position.symbol} (${position.token}) wallet ${short(walletAddress)} sold ${tier.sellPortionPct}% pnl ${tier.pnlSol.toFixed(4)} SOL`
        );
        void writeLog({
          level: "sell",
          source: "paper",
          walletAddress,
          tokenMint: position.token,
          message: `Tier ${tier.tierIndex} take-profit on $${position.symbol ?? "?"}: sold ${tier.sellPortionPct}%, ${tier.pnlSol >= 0 ? "+" : ""}${tier.pnlSol.toFixed(4)} SOL`,
        });
      }

      await recordPartialExit(latestPosition, {
        soldSol: tier.soldSol,
        exitPrice: tierExitPrice,
        exitTxSignature: tierExitSignature,
        pnlSol: tierPnlSol,
        tierIndex: tier.tierIndex,
        ...(isRobinhood
          ? {
              sizeNative: tier.soldSol,
              pnlNative: tierPnlSol,
              nativeSymbol: position.nativeSymbol ?? "ETH",
              chain: "robinhood",
              network: position.network,
              tokenAddress: position.tokenAddress ?? position.token,
            }
          : {}),
      });
      invalidateBreakerCache(walletAddress);
      if (isRobinhood) invalidateRobinhoodBreakerCache(walletAddress);

      triggeredTiers.push(tier.tierIndex);
      remainingSizeSol -= tier.soldSol;
      latestPosition = {
        ...latestPosition,
        sizeSol: String(remainingSizeSol),
        ...(isRobinhood ? { sizeNative: String(remainingSizeSol) } : {}),
        context: { ...context, triggeredTiers },
      };

      // Same numeric threshold and math either way (DUST_THRESHOLD_SOL
      // and DUST_THRESHOLD_NATIVE are the same constant — see
      // lib/sniper/exit-logic.ts) — this line just names the concept
      // correctly for whichever chain this position belongs to, without
      // inventing any SOL<->ETH conversion.
      if (remainingSizeSol <= (isRobinhood ? DUST_THRESHOLD_NATIVE : DUST_THRESHOLD_SOL)) {
        await markPositionClosed(position.id);
        break;
      }
    }
  }
}


// ROBINHOOD-PAPER-ONLY-START (discovery)
// ── PR07: Robinhood `pons new_creation` discovery ───────────────────────
//
// Structurally the same shape as the GMGN Solana loop above (poll →
// pending map → per-wallet eligibility → safety → paper entry), but its
// own discovery source, its own pending map, and — critically — its own
// terminal function (openRobinhoodPaperPosition, ROBINHOOD-PAPER-ONLY
// block above) that never touches Jupiter/live execution. v1 scope only:
// `pons`, `new_creation` — both enforced by discoverRobinhoodTokens()
// itself (lib/gmgn/discovery-robinhood.ts), not re-implemented here.
const ROBINHOOD_POLL_INTERVAL_MS = 5_000;
const ROBINHOOD_MAX_PENDING = 400;

type RobinhoodPending = {
  token: RobinhoodDiscoveredToken;
  firstSeenAt: number;
  attemptedWallets: Set<string>;
  /** Fetched once per pending item (not once per wallet/tick) — same
   * "shared, not re-fetched" posture as PendingToken.tokenData above.
   * `undefined` = not yet attempted; a real object = fetched
   * successfully (individual facts inside it may still be null/unknown
   * — evaluateRobinhoodSafety's existing per-fact fail-closed handling
   * applies as before). A FAILED fetch is tracked separately via
   * `securityFetchFailed` below, NOT by setting this to `null` — a
   * failed fetch must unconditionally block entry, which is a stronger
   * statement than "security object is absent/unknown" (that weaker
   * case is exactly what a disabled requireOwnerRenounced/
   * requireNoBlacklistCapability config could otherwise sail through). */
  security: RobinhoodSecurityFacts | undefined;
  securityFetchFailed: boolean;
  securityFetchFailureReason: string | null;
  priceUsd: number | null | undefined;
};

const robinhoodPending = new Map<string, RobinhoodPending>();

async function processRobinhoodCandidates(): Promise<void> {
  const result = await discoverRobinhoodTokens();

  if (!result.ok) {
    // Every failure branch below is a FAILED cycle, never treated as an
    // empty market — see lib/gmgn/discovery-robinhood.ts's discriminated
    // RobinhoodDiscoveryResult.
    if (result.reason === "not_configured") return; // GMGN_API_KEY unset — quiet, same as the Solana GMGN path's isGmgnConfigured() gate
    if (result.reason === "launchpad_allowlist_not_configured") {
      log("Robinhood discovery: launchpad allow-list not configured (GMGN_ROBINHOOD_LAUNCHPADS unset) — skipping cycle");
      return;
    }
    const detail = "detail" in result ? `: ${result.detail}` : "";
    log(`Robinhood discovery failed this cycle (${result.reason}${detail}) — not treated as an empty market`);
    return;
  }

  const now = Date.now();
  for (const token of result.tokens) {
    if (robinhoodPending.has(token.tokenAddress)) continue;
    robinhoodPending.set(token.tokenAddress, {
      token,
      firstSeenAt: now,
      attemptedWallets: new Set(),
      security: undefined,
      securityFetchFailed: false,
      securityFetchFailureReason: null,
      priceUsd: undefined,
    });
  }

  for (const [addr, item] of robinhoodPending) {
    const everyoneAttempted =
      roster.length > 0 && roster.every((r) => item.attemptedWallets.has(r.bot.walletAddress));
    if (now - item.firstSeenAt > PENDING_MAX_AGE_MS || everyoneAttempted) {
      robinhoodPending.delete(addr);
    }
  }
  while (robinhoodPending.size > ROBINHOOD_MAX_PENDING) {
    const oldest = robinhoodPending.keys().next().value;
    if (oldest == null) break;
    robinhoodPending.delete(oldest);
  }
  if (robinhoodPending.size === 0) return;

  for (const item of robinhoodPending.values()) {
    const ageSec = Date.now() / 1000 - item.token.createdAt;
    const eligible = roster.filter(
      (r) =>
        r.bot.active &&
        !item.attemptedWallets.has(r.bot.walletAddress) &&
        ageSec >= r.config.minTokenAgeSec
    );
    if (eligible.length === 0) continue;

    // Claim synchronously before any await, same TOCTOU-avoidance reason
    // as processPendingToken above.
    for (const { bot } of eligible) item.attemptedWallets.add(bot.walletAddress);

    // A security fetch is attempted once per item and cached either way.
    // A FAILURE unconditionally blocks entry for every bot below — see
    // the loop after the price check — regardless of which optional
    // gates (requireOwnerRenounced/requireNoBlacklistCapability) a given
    // bot's config has disabled. This is deliberately stronger than
    // passing `security: null` into evaluateRobinhoodSafety (which would
    // only fail closed on the specific facts a bot's config actually
    // requires) — an operator disabling those two gates must not be able
    // to make a provider outage look like a safe, ungated candidate.
    if (item.security === undefined && !item.securityFetchFailed) {
      const securityResult = await getRobinhoodTokenSecurity(item.token.tokenAddress);
      if (securityResult.ok) {
        item.security = securityResult.security;
      } else {
        item.securityFetchFailed = true;
        item.securityFetchFailureReason =
          securityResult.reason === "not_configured"
            ? "GMGN_API_KEY not configured"
            : securityResult.reason === "provider_error"
              ? `provider error: ${securityResult.detail}`
              : `malformed_payload: ${securityResult.detail}`;
      }
    }
    if (item.securityFetchFailed) {
      for (const { bot } of eligible) {
        logRobinhoodRefusal(
          bot,
          item.token.tokenAddress,
          item.token.symbol ?? undefined,
          "robinhood",
          item.token.network,
          [
            `security data unavailable (${item.securityFetchFailureReason ?? "fetch failed"}) — refusing unconditionally, not treated as safe`,
          ]
        );
      }
      continue;
    }

    // Price fetch failure means "skip this token, never fabricate a
    // price" — checked once per item, not retried every tick.
    if (item.priceUsd === undefined) {
      const priceResult = await getRobinhoodTokenPriceUsd(item.token.tokenAddress);
      if (!priceResult.ok) {
        log(
          `Robinhood: no trustworthy price for ${item.token.symbol ?? "?"} (${item.token.tokenAddress}) — skipping entry (${priceResult.reason})`
        );
        item.priceUsd = null;
      } else {
        item.priceUsd = priceResult.priceUsd;
      }
    }
    if (item.priceUsd == null) continue;

    for (const { bot, config } of eligible) {
      try {
        // Robinhood discovery is GMGN — a bot configured without "gmgn"
        // in entrySources (e.g. ["pump"] only) must not enter a Robinhood
        // candidate, same source-gate the Solana GMGN path already
        // applies to itself.
        if (!config.entrySources.includes("gmgn")) continue;

        const safety = await evaluateRobinhoodSafety(item.token, item.security ?? null, config, ageSec);
        if (!safety.passed) {
          logRobinhoodRefusal(
            bot,
            item.token.tokenAddress,
            item.token.symbol ?? undefined,
            item.token.launchpad ?? "gmgn",
            item.token.network,
            safety.reasons
          );
          continue;
        }

        await openRobinhoodPaperPosition(bot, config, {
          chain: "robinhood",
          tokenAddress: item.token.tokenAddress,
          symbol: item.token.symbol ?? undefined,
          network: item.token.network,
          entryPrice: item.priceUsd,
          priceUnit: "usd_per_token",
          safety,
          source: "gmgn",
          launchpad: item.token.launchpad,
        });
      } catch (error) {
        log(`Robinhood entry error for ${bot.name} (${short(bot.walletAddress)}):`, error);
      }
    }
  }
}

let robinhoodTimer: ReturnType<typeof setTimeout> | null = null;

async function scheduleRobinhoodPoll(): Promise<void> {
  await runLoopIteration("Robinhood poll", ROBINHOOD_POLL_WATCHDOG_MS, processRobinhoodCandidates);
  robinhoodTimer = setTimeout(() => void scheduleRobinhoodPoll(), ROBINHOOD_POLL_INTERVAL_MS);
}
// ROBINHOOD-PAPER-ONLY-END (discovery)

/* Watchdog budgets. Generous enough that healthy work never trips them,
   short enough that a stall costs one cycle rather than the process. */
const EXIT_CHECK_WATCHDOG_MS = 60_000;
const ROBINHOOD_POLL_WATCHDOG_MS = 60_000;
const ROSTER_WATCHDOG_MS = 30_000;
// scheduleQueueDrain needs none: it never awaits the work it fires, so it
// reschedules regardless of how long any individual evaluation takes.

/**
 * Runs one iteration of a scheduled loop so that it always ends, and the
 * loop always gets to reschedule itself.
 *
 * `.catch()` alone is not enough. It handles a promise that *rejects*; a
 * promise that never settles at all leaves the await hanging, the
 * setTimeout below it never runs, and the loop is dead permanently with
 * nothing logged. That is not hypothetical: exits, GMGN polling and roster
 * refresh all stopped together mid-session while the process stayed alive,
 * and four live positions sat unwatched for hours.
 *
 * The hung work is not cancelled, only abandoned — Promise.race cannot
 * cancel. Every outbound call it makes is individually bounded, so an
 * abandoned iteration settles on its own rather than accumulating.
 */
async function runLoopIteration(
  label: string,
  budgetMs: number,
  work: () => Promise<unknown>
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watchdog = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      log(`WATCHDOG ${label} exceeded ${budgetMs}ms; skipping this cycle`);
      resolve();
    }, budgetMs);
  });
  try {
    await Promise.race([
      work().catch((error) => log(`${label} error`, error)),
      watchdog,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let exitTimer: ReturnType<typeof setTimeout> | null = null;

async function scheduleExitCheck(): Promise<void> {
  await runLoopIteration("exit-check", EXIT_CHECK_WATCHDOG_MS, checkAllExits);
  const interval =
    roster.length > 0
      ? Math.max(MIN_EXIT_CHECK_INTERVAL_MS, Math.min(...roster.map((r) => r.config.exitCheckIntervalMs)))
      : DEFAULT_EXIT_CHECK_INTERVAL_MS;
  exitTimer = setTimeout(() => void scheduleExitCheck(), interval);
}

let rosterTimer: ReturnType<typeof setTimeout> | null = null;

async function scheduleRosterRefresh(): Promise<void> {
  await runLoopIteration("roster refresh", ROSTER_WATCHDOG_MS, refreshRoster);
  rosterTimer = setTimeout(() => void scheduleRosterRefresh(), ROSTER_REFRESH_INTERVAL_MS);
}


async function main(): Promise<void> {
  if (!getDb()) {
    log("DATABASE_URL not configured — exiting, nothing to trade against.");
    process.exit(0);
  }

  /* PR09A: Solana entry sources (PumpPortal stream, GMGN Solana discovery)
     and Solana live execution are retired. Entries come from Robinhood
     discovery only (paper, PR07); existing Solana paper positions are still
     watched and exited so their history closes correctly. */
  log("Paper daemon starting — Robinhood paper trading; Solana entry/execution runtime retired.");

  await refreshRoster();
  log(`Roster: ${roster.length} deployed bot(s).`);
  void scheduleRosterRefresh();
  void scheduleExitCheck();

  if (isGmgnConfigured()) {
    log("Robinhood discovery enabled (paper-only, pons new_creation): PR07.");
    void scheduleRobinhoodPoll();
  } else {
    log("GMGN discovery off (GMGN_API_KEY unset): no Robinhood entries this run.");
  }

  async function shutdown() {
    log("Shutting down paper daemon…");
    if (rosterTimer) clearTimeout(rosterTimer);
    if (exitTimer) clearTimeout(exitTimer);
    if (robinhoodTimer) clearTimeout(robinhoodTimer);
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  log("Fatal error:", error);
  process.exit(1);
});
