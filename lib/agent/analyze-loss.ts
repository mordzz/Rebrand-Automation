import { llmJson } from "@/lib/agent/llm";

/**
 * The only SniperConfig keys a post-mortem is allowed to propose changing -
 * strategy/exit-timing knobs only (percentages, durations, booleans). A
 * fixed, explicit set (not an open dictionary) so the model can't invent
 * fields or touch the safety-critical ones (native risk limits,
 * concurrent-position caps, maxCreatorHoldPct, circuit breaker) without a
 * human authoring that change directly. Mirrors
 * lib/sniper/config.ts#SniperConfig's exit-strategy section.
 */
export type SuggestedConfigDiff = Partial<{
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopEnabled: boolean;
  trailingStopActivationPct: number;
  trailingStopPct: number;
  breakevenAfterPct: number | null;
  maxHoldTimeSec: number | null;
  crashDropPct: number;
  cooldownAfterLossSec: number;
}>;

export type LossAnalysis = {
  cause: string;
  lesson: string;
  suggestedConfig: SuggestedConfigDiff | null;
};

export type ClosedTradeInput = {
  token: string;
  strategy: string;
  entryPrice?: number | string | null;
  exitPrice?: number | string | null;
  sizeNative?: number | string | null;
  pnlNative: number | string;
  openedAt?: string | null;
  closedAt?: string | null;
  context?: Record<string, unknown> | null;
  nativeSymbol?: string | null;
  chain?: string | null;
  network?: string | null;
};

const SUGGESTED_CONFIG_PROPERTIES = {
  takeProfitPct: { type: "number", description: "Flat take-profit target, percent." },
  stopLossPct: { type: "number", description: "Flat stop-loss distance, percent." },
  trailingStopEnabled: { type: "boolean" },
  trailingStopActivationPct: {
    type: "number",
    description: "Gain percent at which the trailing stop arms.",
  },
  trailingStopPct: {
    type: "number",
    description: "How far price can fall off its peak before the trailing stop fires, percent.",
  },
  breakevenAfterPct: {
    type: ["number", "null"],
    description: "Gain percent after which the stop floor locks to entry price (0%). null disables it.",
  },
  maxHoldTimeSec: {
    type: ["number", "null"],
    description: "Force-exit after this many seconds regardless of P&L. null disables it. Use this for 'held too long' losses.",
  },
  crashDropPct: {
    type: "number",
    description: "Single-interval price-drop percent that triggers an immediate emergency exit.",
  },
  cooldownAfterLossSec: {
    type: "number",
    description: "Seconds to pause new entries after any closed loss.",
  },
} as const;

const CAUSE_AND_LESSON_PROPERTIES = {
  cause: {
    type: "string",
    description:
      "The single most important reason this trade lost money, stated concretely in at most 20 words. Examples: 'Held 40 minutes past the momentum peak; take-profit never triggered', 'Entered a pool with unlocked LP; rugged 4 minutes after entry'.",
  },
  lesson: {
    type: "string",
    description:
      "One concrete, machine-actionable rule that would have avoided this loss, in at most 20 words. It must be checkable before or during a trade. Examples: 'Take profit at +60% or 15 minutes after entry, whichever first', 'Require LP locked or burned before any snipe'.",
  },
} as const;

const SUGGESTED_CONFIG_DESCRIPTION =
  "A concrete change to the Sniper's live trading config that would have prevented this specific loss, using ONLY the fields below - omit any field you aren't changing, and return null entirely if no clean config change applies (e.g. the loss was a pure rug no config knob could have caught in time).";

/**
 * Defense in depth: even if a provider's structured-output enforcement were
 * ever imperfect, only the allowed SuggestedConfigDiff keys ever reach a
 * human reviewer. Pure and exported so this is directly unit-testable
 * without an LLM call.
 */
export function sanitizeSuggestedConfig(
  suggestedConfig: Record<string, unknown> | null
): SuggestedConfigDiff | null {
  if (!suggestedConfig) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(suggestedConfig)) {
    if (key in SUGGESTED_CONFIG_PROPERTIES) out[key] = value;
  }
  return out as SuggestedConfigDiff;
}

/** The provider's strict structured-output mode (lib/agent/llm.ts's
 * json_schema/additionalProperties:false) makes the model structurally
 * unable to emit any other key; analyzeLoss additionally filters
 * defensively below. */
export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    ...CAUSE_AND_LESSON_PROPERTIES,
    suggestedConfig: {
      type: ["object", "null"],
      description: SUGGESTED_CONFIG_DESCRIPTION,
      properties: { ...SUGGESTED_CONFIG_PROPERTIES },
      additionalProperties: false,
    },
  },
  required: ["cause", "lesson", "suggestedConfig"],
  additionalProperties: false,
} as const;

/** PnL and position size are in ETH (Robinhood Chain's native asset). */
const SYSTEM_PROMPT = `You are the risk analyst of an automated trading desk running on Robinhood Chain (an EVM-compatible chain). Position size and P&L are denominated in ETH, the chain's native asset. After every losing trade you perform the post-mortem.

You receive the full record of one closed losing trade. Diagnose the primary failure mode - for example: entered too late after launch, stayed in the position too long, take-profit too slow or too greedy, stop-loss too tight or missing, rug/liquidity drain, copied a bad wallet, oversized position. Then distill exactly one reusable rule the trading engine can enforce on future trades.

Be specific and quantitative where the data allows it (use the actual hold time, drawdown, or percentages from the trade record). Never blame "market conditions" alone - always find the controllable factor.

Additionally, if this loss's specific cause maps cleanly onto one of the config fields you're given, propose the exact change as suggestedConfig - a human reviews and approves every suggestion before it's applied, so err toward proposing a change whenever you have real evidence for one rather than leaving it null out of caution. Only return null when the loss was genuinely not addressable by these knobs (e.g. an instant rug that no timing or stop distance could have caught).`;

/**
 * Ask the configured base model (see lib/agent/llm.ts - OpenRouter unless
 * the environment says otherwise) to diagnose a losing trade and produce a
 * reusable rule. Throws if no provider is configured, the call fails, or
 * the reply contains no usable JSON; callers decide how to degrade. A
 * thrown error must never become a fabricated lesson - a wrong post-mortem
 * would teach the fleet the wrong rule.
 */
export async function analyzeLoss(
  trade: ClosedTradeInput
): Promise<LossAnalysis> {
  const holdMinutes =
    trade.openedAt && trade.closedAt
      ? Math.round(
          (new Date(trade.closedAt).getTime() -
            new Date(trade.openedAt).getTime()) /
            60_000
        )
      : null;

  const record = {
    token: trade.token,
    strategy: trade.strategy,
    chain: trade.chain ?? null,
    network: trade.network ?? null,
    // USD/token (see lib/gmgn/price-robinhood.ts); context.priceUnit
    // records this and is passed through via additional_context below.
    entry_price: trade.entryPrice ?? null,
    exit_price: trade.exitPrice ?? null,
    position_size_native: trade.sizeNative ?? null,
    realized_pnl_native: trade.pnlNative,
    native_symbol: trade.nativeSymbol ?? "ETH",
    hold_time_minutes: holdMinutes,
    opened_at: trade.openedAt ?? null,
    closed_at: trade.closedAt ?? null,
    additional_context: trade.context ?? null,
  };

  const result = await llmJson<LossAnalysis>({
    system: SYSTEM_PROMPT,
    user: `Post-mortem this losing trade:\n\n${JSON.stringify(record, null, 2)}`,
    schema: ANALYSIS_SCHEMA,
    schemaName: "loss_analysis",
    maxTokens: 4000,
  });

  result.suggestedConfig = sanitizeSuggestedConfig(result.suggestedConfig);

  return result;
}
