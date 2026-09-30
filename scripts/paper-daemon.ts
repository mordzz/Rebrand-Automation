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
import { deriveEntryPriceSol, discoverTokens, type DiscoveredToken } from "@/lib/gmgn/discovery";
import { evaluateGmgnSafety } from "@/lib/gmgn/safety";
import {
  checkRoundTrip,
  roundTripRefusalReasons,
  type RoundTripResult,
} from "@/lib/jupiter/round-trip";
import { getSolUsdPrice } from "@/lib/sniper/sol-price";
import {
  executeSwap,
  getSwapQuote,
  SOL_MINT,
  solToLamports,
  SwapSimulationFailure,
} from "@/lib/jupiter/swap";
import { getAddressBalance, getRpc } from "@/lib/solana/wallet";
import { address } from "@solana/kit";
import { recordAlphaCandidate } from "@/lib/sniper/alpha-candidates";
import { getMintSupply } from "@/lib/sniper/market-cap";
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
import { canOpenNewPosition, deriveTradingPause, sizeForSnipe } from "@/lib/sniper/risk-limits";
import {
  evaluateSafety,
  fetchTokenSafetyData,
  type SafetyCheckResult,
  type TokenSafetyData,
} from "@/lib/sniper/safety-checks";
import {
  getDailyPnlSol,
  getLastLossAt,
  getRecentOutcomes,
} from "@/lib/sniper/wallet-trade-stats";
import { getSniperConfig, type SniperConfig } from "@/lib/sniper/config";
import { subscribeNewTokenStream, type PumpPortalNewTokenEvent } from "@/lib/solana/pumpportal";

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
import { getOpenPositionsByChain, getOpenSolanaPositions } from "@/lib/sniper/positions";
import {
  getDailyPnlNativeRobinhood,
  getLastLossAtRobinhood,
  getRecentRobinhoodOutcomes,
} from "@/lib/sniper/wallet-trade-stats-robinhood";

const ROSTER_REFRESH_INTERVAL_MS = 20_000;
const QUEUE_DRAIN_INTERVAL_MS = 1_000;
const MAX_PENDING_QUEUE = 500;
// A token stays in the pending queue until every active bot has had one
// evaluation attempt against it (respecting that bot's own minTokenAgeSec),
// or until it's aged out entirely — whichever comes first.
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_METADATA_TIMEOUT_MS = 3000;
const MIN_EXIT_CHECK_INTERVAL_MS = 2000;
const DEFAULT_EXIT_CHECK_INTERVAL_MS = 4000;
// Circuit-breaker state is re-derived from the trades table (see
// lib/sniper/wallet-trade-stats.ts) rather than persisted — cache briefly
// so a burst of pending-token evaluations for the same wallet doesn't
// re-run three DB queries per token.
const BREAKER_CACHE_TTL_MS = 8_000;
// Held back from every live buy for the swap fee and the token account's
// rent, so a wallet can always afford to sell back out of what it bought.
const LIVE_FEE_HEADROOM_SOL = 0.01;

function log(...args: unknown[]) {
  console.log(`[paper ${new Date().toISOString()}]`, ...args);
}

function short(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

type RosterEntry = { bot: UserBot; config: SniperConfig };
let roster: RosterEntry[] = [];

// The house's own Sniper config — used to evaluate every fresh mint for
// the "Alpha" discovery feed (app/alpha), independent of whether anyone
// has deployed a bot yet. Refreshed alongside the roster.
let houseConfig: SniperConfig | null = null;

async function refreshRoster(): Promise<void> {
  const db = getDb();
  if (!db) {
    roster = [];
    houseConfig = null;
    return;
  }
  const [bots, config] = await Promise.all([
    db.select().from(userBots),
    getSniperConfig(),
  ]);
  roster = await Promise.all(
    bots.map(async (bot) => ({ bot, config: await getEffectiveConfig(bot) }))
  );
  houseConfig = config;
}

type BreakerState = Pick<SniperState, "tradingPaused" | "pauseReason" | "lastLossAt">;
const breakerCache = new Map<string, { state: BreakerState; expiresAt: number }>();

function invalidateBreakerCache(wallet: string): void {
  breakerCache.delete(wallet);
}

async function getCachedBreakerState(
  wallet: string,
  breakerResetAt: Date | null,
  config: Pick<SniperConfig, "maxConsecutiveLosses" | "maxDailyDrawdownSol">
): Promise<BreakerState> {
  const cached = breakerCache.get(wallet);
  if (cached && cached.expiresAt > Date.now()) return cached.state;

  const [recentOutcomes, dailyPnlSol, lastLossAt] = await Promise.all([
    getRecentOutcomes(wallet, 50, breakerResetAt),
    getDailyPnlSol(wallet, breakerResetAt),
    getLastLossAt(wallet, breakerResetAt),
  ]);
  const state = deriveTradingPause({ recentOutcomes, dailyPnlSol, lastLossAt }, config);
  breakerCache.set(wallet, { state, expiresAt: Date.now() + BREAKER_CACHE_TTL_MS });
  return state;
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

/** A vetted Solana entry candidate, whichever discovery source produced
 * it. Both Solana sources converge here so risk limits, sizing and
 * position writes have exactly one implementation — a second copy is how
 * the two paths would drift apart on the rules that matter most. */
type EntryCandidate = {
  chain: "solana";
  mint: string;
  symbol: string | undefined;
  /** SOL per token. Must be in SOL: exits price against DexScreener's
   * priceNative, and a mismatched unit here silently corrupts every P&L. */
  entryPrice: number;
  safety: SafetyCheckResult;
  source: "pump" | "gmgn";
  launchpad?: string | null;
};

/** A vetted Robinhood entry candidate — PR07. Structurally separate from
 * EntryCandidate above (a Solana mint address, a SOL price, and a
 * pump/gmgn safety result are simply not the same kind of thing as an
 * EVM address, a USD price, and a Robinhood safety result) rather than
 * folding a `0x...` address into a field whose every other consumer
 * assumes a base58 Solana mint. Never passed to openPaperPosition/
 * executeRealBuy/checkRoundTrip — only to openRobinhoodPaperPosition. */
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

/* Sell simulation is the most expensive gate (two router quotes), so it runs
   last, only for a candidate that already cleared everything cheaper, and is
   memoised per mint: five bots liking the same token costs one round trip,
   not five. Short TTL because pool depth on a minutes-old mint is exactly
   the thing that moves. */
const MAX_ROUND_TRIP_LOSS_PCT = 25;
const ROUND_TRIP_TTL_MS = 20_000;
const roundTripCache = new Map<string, { at: number; result: Promise<RoundTripResult> }>();

function roundTripFor(mint: string, sizeSol: number, slippageBps: number): Promise<RoundTripResult> {
  const hit = roundTripCache.get(mint);
  if (hit && Date.now() - hit.at < ROUND_TRIP_TTL_MS) return hit.result;
  const result = checkRoundTrip({ mint, sizeSol, slippageBps }).catch(
    // A router outage must not read as "unsellable" and refuse everything.
    (): RoundTripResult => ({ kind: "no-route-either-way" })
  );
  roundTripCache.set(mint, { at: Date.now(), result });
  if (roundTripCache.size > 500) {
    for (const [k, v] of roundTripCache) {
      if (Date.now() - v.at > ROUND_TRIP_TTL_MS) roundTripCache.delete(k);
    }
  }
  return result;
}

async function openPaperPosition(
  bot: UserBot,
  config: SniperConfig,
  candidate: EntryCandidate
): Promise<void> {
  await runExclusive(bot.walletAddress, async () => {
    const [allOpenPositions, solanaOpenPositions, breakerState] = await Promise.all([
      // Wallet-global, ALL chains — maxConcurrentPositions keeps its
      // existing single meaning.
      getOpenPositions(bot.walletAddress),
      // Solana-scoped (chain IS NULL or "solana") — the deployed-SOL sum
      // must never include a Robinhood row's ETH-notional sizeSol shadow.
      getOpenSolanaPositions(bot.walletAddress),
      getCachedBreakerState(bot.walletAddress, bot.breakerResetAt, config),
    ]);

    const risk = canOpenNewPosition(allOpenPositions, solanaOpenPositions, breakerState, config);
    if (!risk.allowed) return;

    const sizeSol = sizeForSnipe(config);

    /* Sell simulation at this bot's own size (§9.6). Placed after the risk
       gate so it only costs quotes for a candidate that would otherwise be
       bought. Refuses a mint that can be bought but not sold, and one whose
       round trip already costs more than the trade could plausibly make. */
    const roundTrip = await roundTripFor(
      candidate.mint,
      sizeSol,
      Math.round(config.stopLossPct * 100)
    );
    const sellReasons = roundTripRefusalReasons(roundTrip, MAX_ROUND_TRIP_LOSS_PCT);
    if (sellReasons.length > 0) {
      log(`REFUSED ${candidate.symbol} for ${bot.name}: ${sellReasons[0]}`);
      void writeLog({
        level: "guard",
        source: "manifest",
        walletAddress: bot.walletAddress,
        tokenMint: candidate.mint,
        message: `Refused $${candidate.symbol ?? "?"}: ${sellReasons[0]}`,
      });
      return;
    }

    const via = candidate.source === "gmgn"
      ? ` via ${candidate.launchpad ?? "gmgn"}`
      : "";

    /* Live execution needs every one of these, and the absence of any one
       falls back to paper rather than erroring. Pressing Start alone is
       deliberately not enough: `active` says the bot may trade, tradingMode
       says whether those trades spend real money. */
    const live = await liveExecutionState(bot, sizeSol);

    if (live.ready) {
      try {
        const result = await executeRealBuy(bot, config, candidate, sizeSol);
        if (result) return;
        // Quote or submission failed. Skip this candidate rather than
        // recording a paper fill that never happened — a live bot's
        // ledger claiming a position it does not hold is worse than a
        // missed trade.
        return;
      } catch (error) {
        /* A failed pre-trade simulation is a refusal, not a fault: nothing
           was signed and nothing was sent. It is logged at `guard` so it
           reads as one more thing the agent turned away, alongside the
           Manifest's refusals, rather than as an execution error. That also
           makes it measurable: if this ever starts refusing candidates that
           would have filled, it is visible in the feed with its reason. */
        if (error instanceof SwapSimulationFailure) {
          log(`REFUSED ${candidate.symbol} for ${bot.name}: ${error.message}`);
          void writeLog({
            level: "guard",
            source: "live",
            walletAddress: bot.walletAddress,
            tokenMint: candidate.mint,
            message: `Refused $${candidate.symbol ?? "?"}: swap would revert (${error.message})`,
          });
          return;
        }

        log(`LIVE buy failed for ${bot.name}:`, error);
        void writeLog({
          level: "error",
          source: "live",
          walletAddress: bot.walletAddress,
          tokenMint: candidate.mint,
          message: `Buy failed on $${candidate.symbol ?? "?"}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        });
        return;
      }
    }

    if (live.blockedReason) {
      log(`${bot.name}: live wanted but ${live.blockedReason} — paper fill instead`);
    }

    log(
      `PAPER buy — ${bot.name} (${short(bot.walletAddress)}): ${sizeSol} SOL of ${candidate.symbol}${via} (${candidate.mint}) @ ~${candidate.entryPrice.toExponential(3)} SOL/token`
    );
    // Wallet-scoped: this surfaces in that operator's own console on
    // /deploy, never in the house dashboard's terminal.
    void writeLog({
      level: "buy",
      source: "paper",
      walletAddress: bot.walletAddress,
      tokenMint: candidate.mint,
      message: `Bought ${sizeSol} SOL of $${candidate.symbol ?? "?"}${via} at ${candidate.entryPrice.toExponential(3)} SOL`,
    });

    await openPosition({
      token: candidate.mint,
      symbol: candidate.symbol,
      entryPrice: candidate.entryPrice,
      sizeSol,
      takeProfitPct: config.takeProfitPct,
      stopLossPct: config.stopLossPct,
      entryTxSignature: "paper",
      context: {
        dryRun: true,
        engine: "paper",
        source: candidate.source,
        launchpad: candidate.launchpad ?? null,
        safety: candidate.safety,
      },
      walletAddress: bot.walletAddress,
    });
  });
}

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
// the forbidden identifiers (executeRealBuy, executeRealSell,
// executeSwap, getSwapQuote, checkRoundTrip, getRpc, address( ) between
// these two markers, so this boundary is regression-tested, not just
// documented.
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

/** Every condition that must hold before real money moves. Reported as a
 * reason rather than a bare boolean so the operator can see in their own
 * console why a bot they switched to live is still filling on paper. */
async function liveExecutionState(
  bot: UserBot,
  sizeSol: number
): Promise<{ ready: boolean; blockedReason?: string }> {
  if (bot.tradingMode !== "live") return { ready: false };
  if (!bot.agentSecretEnc || !bot.agentPublicKey) {
    return { ready: false, blockedReason: "no agent wallet" };
  }

  const balance = await getAddressBalance(bot.agentPublicKey);
  if (balance.balanceSol == null) {
    return { ready: false, blockedReason: "could not read agent wallet balance" };
  }
  // Leave headroom for the swap fee and rent on the token account, or the
  // buy lands the wallet somewhere it cannot afford to sell back out of.
  if (balance.balanceSol < sizeSol + LIVE_FEE_HEADROOM_SOL) {
    return {
      ready: false,
      blockedReason: `agent wallet holds ${balance.balanceSol.toFixed(4)} SOL, needs ${(sizeSol + LIVE_FEE_HEADROOM_SOL).toFixed(4)}`,
    };
  }
  return { ready: true };
}

/**
 * A real buy: quote, sign with the agent wallet, submit, and only then
 * record the position.
 *
 * Order matters. The position row is written *after* the swap confirms,
 * using the signature as its identity, so a failure can never leave a
 * ledger entry for a fill that did not happen. There is no retry here —
 * see executeSwap's note on why resubmitting is how one signal turns into
 * two positions.
 */
const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * SOL per **whole** token, from an executed fill.
 *
 * The two legs of a swap are denominated in different bases: SOL amounts
 * are lamports (9 decimals), token amounts are that mint's own smallest
 * unit. Dividing them raw does not cancel to a price, it leaves a factor
 * of 10^(9 − tokenDecimals) behind. At the 6 decimals a pump.fun mint
 * uses that is 1000x.
 *
 * That mattered because exits are decided against DexScreener's
 * `priceNative`, which is SOL per whole token: an entry recorded 1000x too
 * high made every live position read as roughly −99.9% on its first exit
 * check, so the stop fired immediately and the trade closed for the
 * round-trip cost before the configured rules ever applied.
 *
 * Returns null rather than guessing when the mint's decimals cannot be
 * read. A hardcoded exponent here would be the same bug with a different
 * constant, and Token-2022 mints do not all use 6.
 */
async function fillPriceSol(
  mint: string,
  lamports: number,
  tokenSmallestUnits: number,
  rpcUrl?: string | null
): Promise<number | null> {
  if (!(lamports > 0) || !(tokenSmallestUnits > 0)) return null;
  const supply = await getMintSupply(mint, rpcUrl);
  if (!supply) return null;
  const wholeTokens = tokenSmallestUnits / 10 ** supply.decimals;
  if (!(wholeTokens > 0)) return null;
  return lamports / LAMPORTS_PER_SOL / wholeTokens;
}

async function executeRealBuy(
  bot: UserBot,
  config: SniperConfig,
  candidate: EntryCandidate,
  sizeSol: number
): Promise<boolean> {
  const quote = await getSwapQuote({
    inputMint: SOL_MINT,
    outputMint: candidate.mint,
    amount: solToLamports(sizeSol),
    slippageBps: Math.round(config.stopLossPct * 100),
  });
  if (!quote) {
    log(`LIVE buy — no route for ${candidate.symbol} (${candidate.mint})`);
    return false;
  }

  const result = await executeSwap({
    agentSecretEnc: bot.agentSecretEnc!,
    quote,
    rpcUrl: bot.rpcUrl,
  });

  /* Entry price from the fill actually executed, not the pre-trade
     estimate, converted to SOL per whole token so it is in the same unit
     the exit logic prices against. Falls back to the discovery price when
     the mint's decimals cannot be read, which is already in that unit. */
  const filled = await fillPriceSol(
    candidate.mint,
    Number(result.inAmount),
    Number(result.outAmount),
    bot.rpcUrl
  );
  const entryPrice = filled ?? candidate.entryPrice;

  /* Cheap tripwire for exactly the class of bug this replaced. The
     executed price should sit within slippage and impact of the price
     discovery quoted moments earlier; an order-of-magnitude gap means the
     two are not in the same unit, and every exit decision that follows
     would be nonsense. Logged rather than acted on: the buy has already
     landed by this point, so there is nothing left to refuse. */
  if (filled != null && candidate.entryPrice > 0) {
    const ratio = filled / candidate.entryPrice;
    if (ratio > 10 || ratio < 0.1) {
      log(
        `WARNING ${candidate.symbol}: executed entry ${filled.toExponential(3)} is ${ratio.toFixed(1)}x the discovery price ${candidate.entryPrice.toExponential(3)} — exits for this position will be priced against a mismatched unit`
      );
    }
  }

  log(
    `LIVE buy — ${bot.name} (${short(bot.walletAddress)}): ${sizeSol} SOL of ${candidate.symbol} @ ${entryPrice.toExponential(3)} · ${result.signature}`
  );
  void writeLog({
    level: "buy",
    source: "live",
    walletAddress: bot.walletAddress,
    tokenMint: candidate.mint,
    txSignature: result.signature,
    message: `LIVE bought ${sizeSol} SOL of $${candidate.symbol ?? "?"} at ${entryPrice.toExponential(3)} SOL`,
  });

  await openPosition({
    token: candidate.mint,
    symbol: candidate.symbol,
    entryPrice,
    sizeSol,
    takeProfitPct: config.takeProfitPct,
    stopLossPct: config.stopLossPct,
    entryTxSignature: result.signature,
    context: {
      dryRun: false,
      engine: "live",
      source: candidate.source,
      launchpad: candidate.launchpad ?? null,
      tokensBought: result.outAmount,
      safety: candidate.safety,
    },
    walletAddress: bot.walletAddress,
  });
  return true;
}

/** Every refusal, with its reason, written where the operator can see it.
 *
 * Both entry paths used to drop a failed verdict on the floor with a bare
 * `return`, so the only visible evidence a gate had done anything was the
 * absence of a trade. That makes tuning a filter guesswork, and it is the
 * feed §9.7 promises to publish. Only the first reason is stored: the
 * refusal is what matters, and a token failing six checks is not six times
 * more interesting than one failing a single check. */
function logRefusal(
  bot: UserBot,
  mint: string,
  symbol: string | undefined,
  source: string,
  reasons: string[]
): void {
  const reason = reasons[0] ?? "failed entry criteria";

  /* Backlog, not a verdict. "too old by the time it was evaluated" says the
     queue fell behind, not that anything was found wrong with the token,
     and it fires once per bot per stale candidate. On the first run after
     deploy that alone wrote 1,827 rows in twenty minutes, drowning the
     reasons a reader actually needs and putting the refusal feed's write
     volume on the critical path of a process that also has to guard live
     positions. It belongs in the daemon's own log, not the fleet's. */
  if (reason.startsWith("too old by the time it was evaluated")) return;
  void writeLog({
    level: "guard",
    source: "manifest",
    walletAddress: bot.walletAddress,
    tokenMint: mint,
    message: `Refused $${symbol ?? "?"} (${source}): ${reason}`,
  });
}

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

async function tryOpenPaperPosition(
  bot: UserBot,
  config: SniperConfig,
  event: PumpPortalNewTokenEvent,
  tokenData: TokenSafetyData,
  ageSec: number
): Promise<void> {
  /* Source gate. The push stream carries no risk data, so an operator who
     has not opted into it should never take an entry from it — see
     EntrySource in lib/sniper/config.ts. Checked before the safety work so
     a disabled source costs nothing. */
  if (!config.entrySources.includes("pump")) return;

  const safety = await evaluateSafety(event, tokenData, config, ageSec);
  if (!safety.passed) {
    logRefusal(bot, event.mint, event.symbol, "pump", safety.reasons);
    return;
  }

  await openPaperPosition(bot, config, {
    chain: "solana",
    mint: event.mint,
    symbol: event.symbol,
    // Same approximation the house daemon uses — bonding-curve reserves at
    // the create event, before this (simulated) buy would move it.
    entryPrice: event.vSolInBondingCurve / event.vTokensInBondingCurve,
    safety,
    source: "pump",
  });
}

async function tryRecordAlphaCandidate(
  event: PumpPortalNewTokenEvent,
  tokenData: TokenSafetyData,
  ageSec: number
): Promise<void> {
  if (!houseConfig) return;
  const safety = await evaluateSafety(event, tokenData, houseConfig, ageSec);
  if (!safety.passed) return;

  log(`ALPHA candidate — ${event.symbol} (${event.mint}) passed house entry criteria`);
  await recordAlphaCandidate({
    token: event.mint,
    symbol: event.symbol,
    name: event.name,
    ageSec,
    safety,
  });
}

/**
 * Sells an entire live position back to SOL.
 *
 * Reads the token balance from the chain rather than trusting the amount
 * recorded at entry: fees, partial fills and any transfer in between mean
 * the stored figure can drift, and quoting more than the wallet holds
 * simply fails. Returns null on any failure so the caller leaves the
 * position open and retries, instead of booking a close that never
 * happened.
 */
/**
 * Sells a live position, whole or in part.
 *
 * `portion` is what makes a tiered ladder work on real money: without it
 * every exit dumps the entire token balance, so the first tier would
 * liquidate the position while the ledger recorded a 50% trim.
 * `basisSol` is the SOL this slice was bought with, so P&L is measured
 * against what was actually risked on it rather than the whole entry.
 */
/**
 * Three outcomes, not two.
 *
 * "Could not sell" and "there is nothing left to sell" used to collapse
 * into the same `null`, and the caller treated both as retry-next-tick.
 * That is right for the first and permanently wrong for the second: a
 * position whose tokens have already left the wallet can never be sold
 * again, so it stayed open forever, holding a concurrency slot and showing
 * on the dashboard as exposure that does not exist.
 */
type SellOutcome =
  | { kind: "sold"; signature: string; exitPrice: number; pnlSol: number }
  /** Wallet holds none of this mint: it exited outside this process. */
  | { kind: "already-exited" }
  /** Genuine failure; the tokens are still held and this is worth retrying. */
  | { kind: "failed" };

/** A freshly confirmed buy can briefly read as a zero balance on an RPC
 * node that has not caught up. Inside this window an empty wallet is
 * treated as lag and retried; past it, as a real exit. */
const RECONCILE_GRACE_MS = 60_000;

async function executeRealSell(
  bot: UserBot,
  position: {
    id: string;
    token: string;
    symbol: string | null;
    sizeSol: string;
    entryPrice: string;
    context: unknown;
    openedAt: Date;
  },
  reason: string,
  portion?: { sellPortionPct: number; basisSol: number }
): Promise<SellOutcome> {
  try {
    const rpc = getRpc(bot.rpcUrl);
    const { value: accounts } = await rpc
      .getTokenAccountsByOwner(
        address(bot.agentPublicKey!),
        { mint: address(position.token) },
        { encoding: "jsonParsed" }
      )
      .send();

    let held = BigInt(0);
    for (const acc of accounts) {
      const parsed = acc.account.data as unknown as {
        parsed?: { info?: { tokenAmount?: { amount?: string } } };
      };
      const amount = parsed?.parsed?.info?.tokenAmount?.amount;
      if (amount) held += BigInt(amount);
    }

    if (held <= BigInt(0)) {
      const age = Date.now() - position.openedAt.getTime();
      if (age < RECONCILE_GRACE_MS) {
        log(`LIVE sell — ${position.symbol}: wallet reads empty ${Math.round(age / 1000)}s after entry, treating as RPC lag`);
        return { kind: "failed" };
      }
      log(`LIVE sell — ${position.symbol}: wallet holds none, position already exited`);
      return { kind: "already-exited" };
    }

    /* Portion is taken off the balance actually held, not off the original
       entry: earlier tiers have already reduced it, so a percentage of the
       entry would oversell. */
    const sellAmount =
      portion == null
        ? held
        : (held * BigInt(Math.round(portion.sellPortionPct))) / BigInt(100);
    if (sellAmount <= BigInt(0)) {
      log(`LIVE sell — ${position.symbol}: portion rounds to zero, skipping`);
      return { kind: "failed" };
    }

    const config = configByWalletFor(bot.walletAddress);
    const quote = await getSwapQuote({
      inputMint: position.token,
      outputMint: SOL_MINT,
      amount: sellAmount,
      slippageBps: Math.round((config?.stopLossPct ?? 15) * 100),
    });
    if (!quote) {
      log(`LIVE sell — no route for ${position.symbol} (${position.token})`);
      return { kind: "failed" };
    }

    const result = await executeSwap({
      agentSecretEnc: bot.agentSecretEnc!,
      quote,
      rpcUrl: bot.rpcUrl,
    });

    const solOut = Number(result.outAmount) / 1_000_000_000;
    const basisSol = portion?.basisSol ?? Number(position.sizeSol);
    const pnlSol = solOut - basisSol;
    /* Same unit as the entry above: SOL per whole token. If the decimals
       cannot be read, derive it from the realised ratio instead of
       recording a raw quotient in the wrong base — solOut/basisSol is the
       move this exit actually achieved, whatever unit the entry is in. */
    const exitPrice =
      (await fillPriceSol(
        position.token,
        Number(result.outAmount),
        Number(sellAmount),
        bot.rpcUrl
      )) ??
      (basisSol > 0 ? Number(position.entryPrice) * (solOut / basisSol) : 0);

    log(
      `LIVE ${reason} — ${position.symbol} sold for ${solOut.toFixed(5)} SOL, pnl ${pnlSol.toFixed(5)} · ${result.signature}`
    );
    void writeLog({
      level: pnlSol >= 0 ? "sell" : "guard",
      source: "live",
      walletAddress: bot.walletAddress,
      tokenMint: position.token,
      txSignature: result.signature,
      message: `LIVE ${reason} on $${position.symbol ?? "?"}: ${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(5)} SOL`,
    });

    return { kind: "sold", signature: result.signature, exitPrice, pnlSol };
  } catch (error) {
    log(`LIVE sell failed for ${position.symbol}:`, error);
    void writeLog({
      level: "error",
      source: "live",
      walletAddress: bot.walletAddress,
      tokenMint: position.token,
      message: `Sell failed on $${position.symbol ?? "?"}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    });
    return { kind: "failed" };
  }
}

/** Config for one wallet from the current roster, for helpers that run
 * outside the exit loop's own scope. */
function configByWalletFor(wallet: string): SniperConfig | undefined {
  return roster.find((r) => r.bot.walletAddress === wallet)?.config;
}

type PendingToken = {
  event: PumpPortalNewTokenEvent;
  receivedAt: number;
  tokenData: TokenSafetyData | null;
  /** Wallets already given their one evaluation attempt against this
   * token — mirrors the house daemon's "evaluate exactly once" semantics
   * per (wallet, token) pair, just staggered across ticks since different
   * bots can have different minTokenAgeSec thresholds. */
  attemptedWallets: Set<string>;
  /** The house-config "Alpha" evaluation is independent of the per-user
   * roster (it runs even with zero deployed bots), so it needs its own
   * one-attempt flag rather than piggybacking on attemptedWallets. */
  alphaAttempted: boolean;
};

const pendingTokens: PendingToken[] = [];

async function processPendingToken(item: PendingToken): Promise<void> {
  const ageSec = (Date.now() - item.receivedAt) / 1000;
  // .active gates new entries only — a stopped bot's existing open
  // positions must keep being watched and exited by checkAllExits below,
  // which derives its own per-wallet config from the full (unfiltered)
  // roster, not this eligible list. Never abandon risk you're already
  // holding just because the operator hit Stop.
  const eligible = roster.filter(
    (r) =>
      r.bot.active &&
      !item.attemptedWallets.has(r.bot.walletAddress) &&
      ageSec >= r.config.minTokenAgeSec
  );
  const alphaReady =
    !item.alphaAttempted && houseConfig != null && ageSec >= houseConfig.minTokenAgeSec;
  if (eligible.length === 0 && !alphaReady) return;

  // Claim every eligible wallet (and the alpha slot) synchronously, before
  // the metadata fetch below ever awaits. scheduleQueueDrain fires on a
  // fixed timer and doesn't wait for this call to finish, so a fetch that
  // outlasts one drain tick used to leave `eligible` wallets unmarked long
  // enough for the next tick to compute the same "not yet attempted" list
  // and double-enter them (observed live: two buys for one wallet on one
  // token, ~1 drain-interval apart). Marking happens in one synchronous
  // block with no yield point in between, so no concurrent call can ever
  // observe these wallets as unclaimed again.
  for (const { bot } of eligible) item.attemptedWallets.add(bot.walletAddress);
  if (alphaReady) item.alphaAttempted = true;

  if (!item.tokenData) {
    const metadataTimeoutMs = Math.max(
      DEFAULT_METADATA_TIMEOUT_MS,
      houseConfig?.metadataFetchTimeoutMs ?? 0,
      ...eligible.map((r) => r.config.metadataFetchTimeoutMs)
    );
    item.tokenData = await fetchTokenSafetyData(item.event, metadataTimeoutMs);
  }

  if (alphaReady) {
    try {
      await tryRecordAlphaCandidate(item.event, item.tokenData, ageSec);
    } catch (error) {
      log(`alpha evaluation error for ${item.event.symbol} (${item.event.mint}):`, error);
    }
  }

  for (const { bot, config } of eligible) {
    try {
      /* A bot with its own RPC re-reads the mint through it instead of
         reusing the shared result. That costs an extra call, but the
         shared read comes from the public endpoint, and when that
         rate-limits readMintAuthorities returns null — which
         evaluateSafety treats as "could not verify" and refuses the
         token. Paying for one dedicated read is the point of configuring
         a private endpoint at all. Metadata is unaffected (it's an IPFS
         fetch, not RPC), so the shared copy is reused for it. */
      let tokenData = item.tokenData;
      if (bot.rpcUrl) {
        const own = await fetchTokenSafetyData(
          item.event,
          config.metadataFetchTimeoutMs,
          bot.rpcUrl
        );
        tokenData = { ...own, metadata: tokenData.metadata ?? own.metadata };
      }
      await tryOpenPaperPosition(bot, config, item.event, tokenData, ageSec);
    } catch (error) {
      log(`entry evaluation error for ${bot.name} (${short(bot.walletAddress)}):`, error);
    }
  }
}

let queueTimer: ReturnType<typeof setTimeout> | null = null;

async function scheduleQueueDrain(): Promise<void> {
  const now = Date.now();
  const stillPending: PendingToken[] = [];

  for (const item of pendingTokens) {
    const tooOld = now - item.receivedAt > PENDING_MAX_AGE_MS;
    const everyoneAttempted =
      item.alphaAttempted &&
      roster.length > 0 &&
      roster.every((r) => item.attemptedWallets.has(r.bot.walletAddress));
    if (!tooOld && !everyoneAttempted) stillPending.push(item);
  }
  pendingTokens.length = 0;
  pendingTokens.push(...stillPending);

  for (const item of pendingTokens) {
    processPendingToken(item).catch((error) => log("processPendingToken error", error));
  }

  queueTimer = setTimeout(() => void scheduleQueueDrain(), QUEUE_DRAIN_INTERVAL_MS);
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
  // Needed for live exits: selling requires the agent wallet's key.
  const botByWallet = new Map(roster.map((r) => [r.bot.walletAddress, r.bot] as const));
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
    const bot = botByWallet.get(walletAddress);
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
    // Held as the bot itself rather than a boolean so both exit paths are
    // type-narrowed to a bot that definitely has a wallet to sign with.
    const liveBot =
      !isRobinhood && positionContext.engine === "live" && bot?.agentSecretEnc ? bot : null;

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
      const { reason } = decision;
      let { pnlSol } = decision;
      let exitTxSignature = "paper";
      /* The modelled fill, not the observed mark: a threshold exit is
         credited at its trigger (see evaluateFullExit). A live sell
         overwrites this with the executed price below. */
      let exitPrice = decision.fillPrice;

      if (liveBot) {
        const sold = await executeRealSell(liveBot, position, reason);
        if (sold.kind === "failed") {
          // Could not sell — leave the position open and try again next
          // tick. Recording a close we did not perform would tell the
          // operator they are flat while they still hold the token.
          continue;
        }
        if (sold.kind === "already-exited") {
          /* The tokens are gone but this row never got closed: the exit
             landed and the process stopped before the write. Retrying can
             never resolve it, because there is nothing left to sell, so the
             row is squared against the chain here instead.

             The price and P&L recorded are the engine's own modelled exit,
             not an observed fill — the real one happened outside this
             process and its number is not recoverable from here. Both the
             reason and the signature field say so, so this trade is never
             mistaken for a measured one. */
          log(`RECONCILED ${position.symbol} for ${liveBot.name}: wallet already flat, closing stale row`);
          void writeLog({
            level: "guard",
            source: "live",
            walletAddress,
            tokenMint: position.token,
            message: `Reconciled $${position.symbol ?? "?"}: exit landed outside the engine, position closed against the chain`,
          });
          await closePosition(position, {
            exitPrice,
            exitTxSignature: "reconciled",
            pnlSol,
            reason: `${reason} (reconciled against chain; P&L modelled, not an observed fill)`,
          });
          invalidateBreakerCache(walletAddress);
          continue;
        }
        exitTxSignature = sold.signature;
        exitPrice = sold.exitPrice;
        pnlSol = sold.pnlSol;
      } else if (isRobinhood) {
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
      let tierExitSignature = "paper";
      let tierExitPrice = tier.fillPrice;
      let tierPnlSol = tier.pnlSol;

      if (liveBot) {
        const sold = await executeRealSell(
          liveBot,
          latestPosition,
          `tier ${tier.tierIndex} take-profit`,
          { sellPortionPct: tier.sellPortionPct, basisSol: tier.soldSol }
        );
        /* Stop the ladder rather than recording a trim that never
           happened — the tier stays untriggered and is retried next tick.
           Booking it would shrink the ledger's position while the wallet
           still held every token, and every later figure would be wrong. */
        if (sold.kind === "failed") break;
        if (sold.kind === "already-exited") {
          /* Nothing left to trim: the whole position left the wallet. A
             partial exit would be meaningless, so close the row outright
             and stop the ladder. */
          log(`RECONCILED ${position.symbol} for ${liveBot.name}: wallet flat mid-ladder, closing stale row`);
          await markPositionClosed(position.id);
          invalidateBreakerCache(walletAddress);
          break;
        }
        tierExitSignature = sold.signature;
        tierExitPrice = sold.exitPrice;
        tierPnlSol = sold.pnlSol;
      } else if (isRobinhood) {
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

/* ── GMGN multi-launchpad discovery ──────────────────────────────────────
 *
 * Second entry source, running alongside the PumpPortal stream rather
 * than replacing it: PumpPortal is pump.fun-only but push-based, GMGN
 * covers every indexed launchpad (bags, believe, letsbonk, boop, heaven,
 * moonshot, meteora, …) but is polled. See lib/gmgn/discovery.ts.
 *
 * Deliberately wired into the PAPER daemon only. scripts/sniper-daemon.ts
 * holds the real wallet key, and widening what that process is willing to
 * buy is not a change to make off the back of a new data source that has
 * no live track record here yet.
 */
const GMGN_POLL_INTERVAL_MS = 5_000;
/** Bounds the pending map. Well above one poll's worth (80 per stage). */
const GMGN_MAX_PENDING = 400;

type GmgnPending = {
  token: DiscoveredToken;
  firstSeenAt: number;
  attemptedWallets: Set<string>;
};

const gmgnPending = new Map<string, GmgnPending>();

async function processGmgnCandidates(): Promise<void> {
  if (!isGmgnConfigured()) return;

  const discovered = await discoverTokens(["new_creation"]);
  const now = Date.now();

  for (const token of discovered) {
    if (gmgnPending.has(token.mint)) continue;
    gmgnPending.set(token.mint, {
      token,
      firstSeenAt: now,
      attemptedWallets: new Set(),
    });
  }

  // Age out, and hard-cap so a long run cannot grow this without bound.
  for (const [mint, item] of gmgnPending) {
    const everyoneAttempted =
      roster.length > 0 &&
      roster.every((r) => item.attemptedWallets.has(r.bot.walletAddress));
    if (now - item.firstSeenAt > PENDING_MAX_AGE_MS || everyoneAttempted) {
      gmgnPending.delete(mint);
    }
  }
  while (gmgnPending.size > GMGN_MAX_PENDING) {
    const oldest = gmgnPending.keys().next().value;
    if (oldest == null) break;
    gmgnPending.delete(oldest);
  }

  if (gmgnPending.size === 0) return;

  // One rate lookup per cycle, shared by every candidate: GMGN quotes market
  // cap in USD and positions are denominated in SOL.
  const solUsd = await getSolUsdPrice();
  if (solUsd == null) {
    log("GMGN: no SOL/USD rate available, skipping this cycle");
    return;
  }

  for (const item of gmgnPending.values()) {
    const ageSec = Date.now() / 1000 - item.token.createdAt;

    const eligible = roster.filter(
      (r) =>
        r.bot.active &&
        !item.attemptedWallets.has(r.bot.walletAddress) &&
        ageSec >= r.config.minTokenAgeSec
    );
    if (eligible.length === 0) continue;

    const entryPrice = deriveEntryPriceSol(item.token, solUsd);
    // No trustworthy price means no position. Claim the wallets anyway so
    // an unpriceable token isn't retried every cycle for the rest of its life.
    for (const { bot } of eligible) item.attemptedWallets.add(bot.walletAddress);
    if (entryPrice == null) continue;

    for (const { bot, config } of eligible) {
      try {
        if (!config.entrySources.includes("gmgn")) continue;
        const safety = await evaluateGmgnSafety(item.token, config, ageSec, solUsd);
        if (!safety.passed) {
          logRefusal(
            bot,
            item.token.mint,
            item.token.symbol ?? undefined,
            item.token.launchpad ?? "gmgn",
            safety.reasons
          );
          continue;
        }
        await openPaperPosition(bot, config, {
          chain: "solana",
          mint: item.token.mint,
          symbol: item.token.symbol ?? undefined,
          entryPrice,
          safety,
          source: "gmgn",
          launchpad: item.token.launchpad,
        });
      } catch (error) {
        log(`GMGN entry error for ${bot.name} (${short(bot.walletAddress)}):`, error);
      }
    }
  }
}

let gmgnTimer: ReturnType<typeof setTimeout> | null = null;

async function scheduleGmgnPoll(): Promise<void> {
  await runLoopIteration("GMGN poll", GMGN_POLL_WATCHDOG_MS, processGmgnCandidates);
  gmgnTimer = setTimeout(() => void scheduleGmgnPoll(), GMGN_POLL_INTERVAL_MS);
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
const GMGN_POLL_WATCHDOG_MS = 60_000;
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

/**
 * State reconciliation on start (§11.4).
 *
 * The ledger and the chain can disagree across a restart, and the dangerous
 * direction is a *live* position the wallet no longer holds: the exit loop
 * would then try to sell nothing on every tick, forever, and the operator
 * would see a position they do not own. Causes include a buy whose
 * confirmation was never observed, a manual sale from the exported key, or a
 * rug that burned the balance.
 *
 * Only positions this process could act on are examined, and only live ones:
 * a paper position has no chain state to disagree with. A read failure is
 * left alone rather than closed, because "could not check" must never
 * become "assumed gone".
 */
async function reconcileOnStart(): Promise<void> {
  const db = getDb();
  if (!db) return;

  const open = await db
    .select()
    .from(positions)
    .where(and(eq(positions.status, "open"), isNotNull(positions.walletAddress)));
  if (open.length === 0) return;

  const botByWallet = new Map(roster.map((r) => [r.bot.walletAddress, r.bot] as const));
  let checked = 0;
  let phantom = 0;
  let orphaned = 0;

  for (const position of open) {
    const wallet = position.walletAddress;
    if (!wallet) continue;
    const bot = botByWallet.get(wallet);
    if (!bot) {
      // The bot was deleted while holding a position. Nothing can exit it.
      orphaned++;
      log(
        `RECONCILE orphan — ${position.symbol ?? position.token.slice(0, 8)} belongs to wallet ${short(wallet)}, which has no deployed bot`
      );
      continue;
    }

    // Explicit chain guard, independent of context.engine: a
    // chain="robinhood" row must NEVER reach heldTokenAmount/getRpc/
    // @solana/kit's address() below, even if a corrupt or future row
    // somehow also carried context.engine === "live" — this check comes
    // first and short-circuits before that one is even read.
    if (position.chain === "robinhood") continue;

    const context = (position.context ?? {}) as Record<string, unknown>;
    if (context.engine !== "live" || !bot.agentPublicKey) continue;

    checked++;
    const held = await heldTokenAmount(bot, position.token);
    if (held == null) continue; // could not read; leave it open
    if (held > BigInt(0)) continue; // ledger and chain agree

    phantom++;
    log(
      `RECONCILE phantom — ${position.symbol ?? position.token.slice(0, 8)} marked open but the agent wallet holds none; closing as reconciled`
    );
    void writeLog({
      level: "warn",
      source: "live",
      walletAddress: wallet,
      tokenMint: position.token,
      message: `Reconciled on restart: $${position.symbol ?? "?"} was open in the ledger but the agent wallet holds none. Closed without a sale.`,
    });
    await markPositionClosed(position.id);
  }

  log(
    `Reconciled ${open.length} open position(s): ${checked} live checked, ${phantom} phantom closed, ${orphaned} orphaned.`
  );
}

/** Token units the agent wallet currently holds, or null if unreadable. */
async function heldTokenAmount(bot: UserBot, mint: string): Promise<bigint | null> {
  try {
    const rpc = getRpc(bot.rpcUrl);
    const { value: accounts } = await rpc
      .getTokenAccountsByOwner(
        address(bot.agentPublicKey!),
        { mint: address(mint) },
        { encoding: "jsonParsed" }
      )
      .send();
    let held = BigInt(0);
    for (const acc of accounts) {
      const parsed = acc.account.data as unknown as {
        parsed?: { info?: { tokenAmount?: { amount?: string } } };
      };
      const amount = parsed?.parsed?.info?.tokenAmount?.amount;
      if (amount) held += BigInt(amount);
    }
    return held;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (!getDb()) {
    log("DATABASE_URL not configured — exiting, nothing to trade against.");
    process.exit(0);
  }

  /* The name is historical. This process does sign and spend for any bot
     whose tradingMode is "live", using that bot's own agent wallet key —
     the previous banner claimed "no wallet, no signing" and was printed
     twelve seconds before the first real buy of a live session. */
  log("Paper daemon starting — paper bots get simulated fills; live bots sign real swaps from their own agent wallets.");

  await refreshRoster();
  const liveCount = roster.filter(
    (r) => r.bot.tradingMode === "live" && r.bot.active
  ).length;
  log(
    `Roster: ${roster.length} deployed bot(s), ${liveCount} live and active${liveCount > 0 ? " — this process will spend real SOL" : ""}.`
  );
  await reconcileOnStart().catch((error) => log("reconcile error", error));
  void scheduleRosterRefresh();
  void scheduleExitCheck();
  void scheduleQueueDrain();

  if (isGmgnConfigured()) {
    log("GMGN discovery enabled: multi-launchpad entries alongside the pump.fun stream.");
    void scheduleGmgnPoll();
    log("Robinhood discovery enabled (paper-only, pons new_creation): PR07.");
    void scheduleRobinhoodPoll();
  } else {
    log("GMGN discovery off (GMGN_API_KEY unset): pump.fun stream only. Robinhood discovery also off (same key).");
  }

  const unsubscribe = subscribeNewTokenStream(
    (event) => {
      pendingTokens.push({
        event,
        receivedAt: Date.now(),
        tokenData: null,
        attemptedWallets: new Set(),
        alphaAttempted: false,
      });
      if (pendingTokens.length > MAX_PENDING_QUEUE) pendingTokens.shift();
    },
    (message) => log(message)
  );

  async function shutdown() {
    log("Shutting down paper daemon…");
    if (rosterTimer) clearTimeout(rosterTimer);
    if (exitTimer) clearTimeout(exitTimer);
    if (queueTimer) clearTimeout(queueTimer);
    if (gmgnTimer) clearTimeout(gmgnTimer);
    if (robinhoodTimer) clearTimeout(robinhoodTimer);
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
