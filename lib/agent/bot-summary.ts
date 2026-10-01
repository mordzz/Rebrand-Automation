/**
 * Bot summaries for display (stats, atelier, agent chat).
 *
 * Display only - no trading decision is made here. It reuses the exact
 * functions scripts/paper-daemon.ts uses, so what the UI shows matches
 * what the daemon enforces:
 *   - PnL is summed in ETH (pnlNative).
 *   - Circuit-breaker status uses deriveRobinhoodTradingPause with the
 *     bot's Robinhood native limits (unset limits = entries refused, which
 *     is exactly how the daemon behaves).
 *   - Agent balance is read with the Robinhood RPC for EVM agent wallets.
 */
import { formatEther } from "viem";

import { ROBINHOOD_NATIVE_SYMBOL, ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { getNativeBalance } from "@/lib/chain/rpc";
import type { SniperConfig } from "@/lib/sniper/config";
import { deriveRobinhoodTradingPause, resolveRobinhoodNativeLimits } from "@/lib/sniper/risk-limits-robinhood";
import {
  getDailyPnlNativeRobinhood,
  getLastLossAtRobinhood,
  getRecentRobinhoodOutcomes,
} from "@/lib/sniper/wallet-trade-stats-robinhood";

type TradeLike = { pnlNative: string | number };

export type PnlSummary = {
  /** Realized PnL, in `nativeSymbol`. */
  pnlNative: number;
  nativeSymbol: typeof ROBINHOOD_NATIVE_SYMBOL;
};

export function summarizePnl(rows: TradeLike[]): PnlSummary {
  let pnlNative = 0;
  for (const t of rows) pnlNative += Number(t.pnlNative) || 0;
  return { pnlNative, nativeSymbol: ROBINHOOD_NATIVE_SYMBOL };
}

/** Whether a trade closed in profit - for win counting. */
export function tradeWon(t: TradeLike): boolean {
  return Number(t.pnlNative) > 0;
}

/** The breaker state the daemon enforces for this Robinhood bot. */
export async function robinhoodBreakerStatus(
  wallet: string,
  breakerResetAt: Date | null,
  config: SniperConfig,
): Promise<{ tradingPaused: boolean; pauseReason: string | null }> {
  const limits = resolveRobinhoodNativeLimits(config);
  if (!limits.ok) return { tradingPaused: true, pauseReason: limits.reason };
  const [recentOutcomes, dailyPnlNative, lastLossAt] = await Promise.all([
    getRecentRobinhoodOutcomes(wallet, 50, breakerResetAt),
    getDailyPnlNativeRobinhood(wallet, breakerResetAt),
    getLastLossAtRobinhood(wallet, breakerResetAt),
  ]);
  const state = deriveRobinhoodTradingPause(
    { recentOutcomes: recentOutcomes.map((t) => ({ pnlNative: t.pnlNative, closedAt: t.closedAt })), dailyPnlNative, lastLossAt },
    config,
    limits.limits,
  );
  return { tradingPaused: state.tradingPaused, pauseReason: state.pauseReason };
}

/** The agent wallet's ETH balance (Robinhood agents only), else null. */
export async function agentNativeBalance(bot: {
  agentChain: string | null;
  agentNetwork: string | null;
  agentPublicKey: string | null;
}): Promise<number | null> {
  if (bot.agentChain !== "robinhood" || bot.agentNetwork !== ROBINHOOD_NETWORK || !bot.agentPublicKey) return null;
  try {
    return Number(formatEther(await getNativeBalance(bot.agentPublicKey)));
  } catch {
    return null;
  }
}
