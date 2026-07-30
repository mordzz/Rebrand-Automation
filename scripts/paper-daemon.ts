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
} from "@/lib/jupiter/swap";
import { getAddressBalance, getRpc } from "@/lib/solana/wallet";
import { address } from "@solana/kit";
import { recordAlphaCandidate } from "@/lib/sniper/alpha-candidates";
import { getEffectiveConfig } from "@/lib/sniper/effective-config";
import { DUST_THRESHOLD_SOL, evaluateFullExit, evaluateTieredExits } from "@/lib/sniper/exit-logic";
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

/** A vetted entry candidate, whichever discovery source produced it. Both
 * sources converge here so risk limits, sizing and position writes have
 * exactly one implementation — a second copy is how the two paths would
 * drift apart on the rules that matter most. */
type EntryCandidate = {
  mint: string;
  symbol: string | undefined;
  /** SOL per token. Must be in SOL: exits price against DexScreener's
   * priceNative, and a mismatched unit here silently corrupts every P&L. */
  entryPrice: number;
  safety: SafetyCheckResult;
  source: "pump" | "gmgn";
  launchpad?: string | null;
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
    const [openPositions, breakerState] = await Promise.all([
      getOpenPositions(bot.walletAddress),
      getCachedBreakerState(bot.walletAddress, bot.breakerResetAt, config),
    ]);

    const risk = canOpenNewPosition(openPositions, breakerState, config);
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

  /* Entry price from the fill actually quoted, not the pre-trade estimate:
     SOL spent over tokens received, both in their smallest units, which
     cancel to SOL per token — the same unit exits are priced in. */
  const tokensOut = Number(result.outAmount);
  const entryPrice =
    tokensOut > 0 ? Number(result.inAmount) / tokensOut : candidate.entryPrice;

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

async function tryOpenPaperPosition(
  bot: UserBot,
  config: SniperConfig,
  event: PumpPortalNewTokenEvent,
  tokenData: TokenSafetyData,
  ageSec: number
): Promise<void> {
  const safety = await evaluateSafety(event, tokenData, config, ageSec);
  if (!safety.passed) return;

  await openPaperPosition(bot, config, {
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
async function executeRealSell(
  bot: UserBot,
  position: { id: string; token: string; symbol: string | null; sizeSol: string; entryPrice: string; context: unknown },
  reason: string,
  portion?: { sellPortionPct: number; basisSol: number }
): Promise<{ signature: string; exitPrice: number; pnlSol: number } | null> {
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
      log(`LIVE sell — ${position.symbol}: agent wallet holds none, skipping`);
      return null;
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
      return null;
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
      return null;
    }

    const result = await executeSwap({
      agentSecretEnc: bot.agentSecretEnc!,
      quote,
      rpcUrl: bot.rpcUrl,
    });

    const solOut = Number(result.outAmount) / 1_000_000_000;
    const basisSol = portion?.basisSol ?? Number(position.sizeSol);
    const pnlSol = solOut - basisSol;
    const exitPrice =
      Number(sellAmount) > 0 ? Number(result.outAmount) / Number(sellAmount) : 0;

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

    return { signature: result.signature, exitPrice, pnlSol };
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
    return null;
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
  function priceFor(mint: string): Promise<number | null> {
    let cached = priceCache.get(mint);
    if (!cached) {
      cached = getCurrentPrice(mint);
      priceCache.set(mint, cached);
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

    const currentPrice = await priceFor(position.token);
    if (currentPrice == null) continue;

    const entryPrice = Number(position.entryPrice);
    const sizeSol = Number(position.sizeSol);

    /* A position opened with real money has to be closed with a real
       sale, whole or in tiers. Gated on the position itself, not the bot's
       current mode: switching a bot back to paper must not strand a live
       position with no way out. */
    const positionContext = (position.context ?? {}) as Record<string, unknown>;
    // Held as the bot itself rather than a boolean so both exit paths are
    // type-narrowed to a bot that definitely has a wallet to sign with.
    const liveBot =
      positionContext.engine === "live" && bot?.agentSecretEnc ? bot : null;

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
        if (!sold) {
          // Could not sell — leave the position open and try again next
          // tick. Recording a close we did not perform would tell the
          // operator they are flat while they still hold the token.
          continue;
        }
        exitTxSignature = sold.signature;
        exitPrice = sold.exitPrice;
        pnlSol = sold.pnlSol;
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

      await closePosition(position, { exitPrice, exitTxSignature, pnlSol, reason });
      invalidateBreakerCache(walletAddress);
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
        if (!sold) break;
        tierExitSignature = sold.signature;
        tierExitPrice = sold.exitPrice;
        tierPnlSol = sold.pnlSol;
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
      });
      invalidateBreakerCache(walletAddress);

      triggeredTiers.push(tier.tierIndex);
      remainingSizeSol -= tier.soldSol;
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
        const safety = await evaluateGmgnSafety(item.token, config, ageSec);
        if (!safety.passed) continue;
        await openPaperPosition(bot, config, {
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
  await processGmgnCandidates().catch((error) => log("GMGN poll error", error));
  gmgnTimer = setTimeout(() => void scheduleGmgnPoll(), GMGN_POLL_INTERVAL_MS);
}

let exitTimer: ReturnType<typeof setTimeout> | null = null;

async function scheduleExitCheck(): Promise<void> {
  await checkAllExits().catch((error) => log("exit-check error", error));
  const interval =
    roster.length > 0
      ? Math.max(MIN_EXIT_CHECK_INTERVAL_MS, Math.min(...roster.map((r) => r.config.exitCheckIntervalMs)))
      : DEFAULT_EXIT_CHECK_INTERVAL_MS;
  exitTimer = setTimeout(() => void scheduleExitCheck(), interval);
}

let rosterTimer: ReturnType<typeof setTimeout> | null = null;

async function scheduleRosterRefresh(): Promise<void> {
  await refreshRoster().catch((error) => log("roster refresh error", error));
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

  log("Paper daemon starting — simulated trades only, no wallet, no signing.");

  await refreshRoster();
  log(`Roster: ${roster.length} deployed bot(s).`);
  await reconcileOnStart().catch((error) => log("reconcile error", error));
  void scheduleRosterRefresh();
  void scheduleExitCheck();
  void scheduleQueueDrain();

  if (isGmgnConfigured()) {
    log("GMGN discovery enabled: multi-launchpad entries alongside the pump.fun stream.");
    void scheduleGmgnPoll();
  } else {
    log("GMGN discovery off (GMGN_API_KEY unset): pump.fun stream only.");
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
