import { llmJson } from "@/lib/agent/llm";

/**
 * Strategy/exit-timing knobs a post-mortem may propose for EITHER chain —
 * chain-neutral by construction (percentages, durations, booleans; no
 * currency-denominated or chain-specific safety field). Mirrors
 * lib/sniper/config.ts#SniperConfig's exit-strategy section.
 */
type CommonSuggestedConfig = Partial<{
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

/**
 * The only SniperConfig keys a Solana post-mortem is allowed to propose
 * changing — a fixed, explicit set (not an open dictionary) so the model
 * can't invent nonsense fields or touch the safety-critical ones (max SOL
 * per snipe, concurrent-position caps, circuit breaker) without a human
 * authoring that change directly.
 *
 * `maxCreatorBuyPct` is Solana-only initial-buy policy — deliberately
 * NOT part of CommonSuggestedConfig, so a Robinhood post-mortem
 * (RobinhoodSuggestedConfigDiff below) structurally cannot include it.
 * There is no approved architecture in PR07 for an AI lesson to tune the
 * Robinhood-equivalent safety-critical field (maxCreatorHoldPct), so
 * this PR does not invent one — a Robinhood suggestedConfig is simply
 * restricted to the common knobs above.
 */
export type SuggestedConfigDiff = CommonSuggestedConfig & Partial<{ maxCreatorBuyPct: number }>;

/** What a Robinhood post-mortem may propose — the common knobs only, no
 * Solana-only field. */
export type RobinhoodSuggestedConfigDiff = CommonSuggestedConfig;

export type LossAnalysis = {
  cause: string;
  lesson: string;
  suggestedConfig: SuggestedConfigDiff | RobinhoodSuggestedConfigDiff | null;
};

export type ClosedTradeInput = {
  token: string;
  strategy: string;
  entryPrice?: number | string | null;
  exitPrice?: number | string | null;
  sizeSol?: number | string | null;
  pnlSol: number | string;
  openedAt?: string | null;
  closedAt?: string | null;
  context?: Record<string, unknown> | null;

  /* PR04 chain-neutral trade columns — optional, Robinhood-only (PR07).
   * Every existing caller omits these; the post-mortem prompt below
   * still reads pnlSol/sizeSol only (unchanged — the AI reflection
   * workflow is out of scope for this PR), so these are persisted
   * alongside the legacy fields but are not yet consumed by
   * analyzeLoss(). */
  sizeNative?: number | string | null;
  pnlNative?: number | string | null;
  nativeSymbol?: string | null;
  chain?: string | null;
  network?: string | null;
};

/** Shared suggestedConfig property definitions — identical wording for
 * both chains, since these are the same strategy/exit-timing concepts
 * either way. Solana's schema adds maxCreatorBuyPct on top; Robinhood's
 * does not. */
const COMMON_SUGGESTED_CONFIG_PROPERTIES = {
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
  "A concrete change to the Sniper's live trading config that would have prevented this specific loss, using ONLY the fields below — omit any field you aren't changing, and return null entirely if no clean config change applies (e.g. the loss was a pure rug no config knob could have caught in time).";

/**
 * Chain-aware defense in depth: even if a provider's structured-output
 * enforcement were ever imperfect, a Robinhood loss must never carry the
 * Solana-only maxCreatorBuyPct suggestion through to a human reviewer.
 * Pure and exported so this is directly unit-testable without an LLM
 * call — see scripts/test-analyze-loss.ts.
 */
export function sanitizeSuggestedConfigForChain(
  suggestedConfig: SuggestedConfigDiff | RobinhoodSuggestedConfigDiff | null,
  chain: string | null | undefined
): SuggestedConfigDiff | RobinhoodSuggestedConfigDiff | null {
  if (chain !== "robinhood" || !suggestedConfig) return suggestedConfig;
  if (!("maxCreatorBuyPct" in suggestedConfig)) return suggestedConfig;
  const config = { ...suggestedConfig } as SuggestedConfigDiff;
  delete config.maxCreatorBuyPct;
  return config;
}

export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    ...CAUSE_AND_LESSON_PROPERTIES,
    suggestedConfig: {
      type: ["object", "null"],
      description: SUGGESTED_CONFIG_DESCRIPTION,
      properties: {
        ...COMMON_SUGGESTED_CONFIG_PROPERTIES,
        maxCreatorBuyPct: {
          type: "number",
          description: "Reject a snipe if the creator's own initial buy exceeds this percent of supply.",
        },
      },
      additionalProperties: false,
    },
  },
  required: ["cause", "lesson", "suggestedConfig"],
  additionalProperties: false,
} as const;

/** Robinhood counterpart — identical shape except suggestedConfig never
 * offers maxCreatorBuyPct (Solana-only initial-buy policy; no
 * Robinhood-equivalent AI-tunable field exists in PR07 — see the module
 * comment on SuggestedConfigDiff). The provider's strict structured-
 * output mode (lib/agent/llm.ts's json_schema/additionalProperties:false)
 * makes the model structurally unable to emit that key against this
 * schema; analyzeLoss additionally strips it defensively below. */
export const ROBINHOOD_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    ...CAUSE_AND_LESSON_PROPERTIES,
    suggestedConfig: {
      type: ["object", "null"],
      description: SUGGESTED_CONFIG_DESCRIPTION,
      properties: { ...COMMON_SUGGESTED_CONFIG_PROPERTIES },
      additionalProperties: false,
    },
  },
  required: ["cause", "lesson", "suggestedConfig"],
  additionalProperties: false,
} as const;

const SOLANA_SYSTEM_PROMPT = `You are the risk analyst of an automated Solana memecoin trading desk. After every losing trade you perform the post-mortem.

You receive the full record of one closed losing trade. Diagnose the primary failure mode — for example: entered too late after launch, stayed in the position too long, take-profit too slow or too greedy, stop-loss too tight or missing, rug/liquidity drain, copied a bad wallet, oversized position. Then distill exactly one reusable rule the trading engine can enforce on future trades.

Be specific and quantitative where the data allows it (use the actual hold time, drawdown, or percentages from the trade record). Never blame "market conditions" alone — always find the controllable factor.

Additionally, if this loss's specific cause maps cleanly onto one of the config fields you're given, propose the exact change as suggestedConfig — a human reviews and approves every suggestion before it's applied, so err toward proposing a change whenever you have real evidence for one rather than leaving it null out of caution. Only return null when the loss was genuinely not addressable by these knobs (e.g. an instant rug that no timing or stop distance could have caught).`;

/** Same body as SOLANA_SYSTEM_PROMPT, describing the desk correctly for
 * a Robinhood Chain (EVM) trade — PnL and position size are in ETH, not
 * SOL, and the record below uses native_symbol/chain/network fields
 * instead of a bare SOL assumption. */
const ROBINHOOD_SYSTEM_PROMPT = `You are the risk analyst of an automated trading desk running on Robinhood Chain (an EVM-compatible chain) as well as Solana. This particular trade was executed on Robinhood Chain — its position size and P&L are denominated in ETH (the chain's native asset), not SOL. After every losing trade you perform the post-mortem.

You receive the full record of one closed losing trade. Diagnose the primary failure mode — for example: entered too late after launch, stayed in the position too long, take-profit too slow or too greedy, stop-loss too tight or missing, rug/liquidity drain, copied a bad wallet, oversized position. Then distill exactly one reusable rule the trading engine can enforce on future trades.

Be specific and quantitative where the data allows it (use the actual hold time, drawdown, or percentages from the trade record). Never blame "market conditions" alone — always find the controllable factor.

Additionally, if this loss's specific cause maps cleanly onto one of the config fields you're given, propose the exact change as suggestedConfig — a human reviews and approves every suggestion before it's applied, so err toward proposing a change whenever you have real evidence for one rather than leaving it null out of caution. Only return null when the loss was genuinely not addressable by these knobs (e.g. an instant rug that no timing or stop distance could have caught).`;

/**
 * Ask the configured base model (see lib/agent/llm.ts — OpenRouter unless
 * the environment says otherwise) to diagnose a losing trade and produce a
 * reusable rule. Throws if no provider is configured, the call fails, or
 * the reply contains no usable JSON; callers decide how to degrade. A
 * thrown error must never become a fabricated lesson — a wrong post-mortem
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

  const isRobinhood = trade.chain === "robinhood";

  const record = isRobinhood
    ? {
        token: trade.token,
        strategy: trade.strategy,
        chain: "robinhood",
        network: trade.network ?? null,
        // entryPrice/exitPrice are USD/token for Robinhood (see
        // lib/gmgn/price-robinhood.ts) — the context.priceUnit field
        // already records this, passed through via additional_context
        // below, unchanged from the Solana record's semantics.
        entry_price: trade.entryPrice ?? null,
        exit_price: trade.exitPrice ?? null,
        // Native (sizeNative) is authoritative when present; sizeSol is
        // only ever a compatibility shadow for a Robinhood row (see
        // lib/sniper/positions.ts), so it is not read here at all.
        position_size_native: trade.sizeNative ?? null,
        realized_pnl_native: trade.pnlNative ?? trade.pnlSol,
        native_symbol: trade.nativeSymbol ?? "ETH",
        hold_time_minutes: holdMinutes,
        opened_at: trade.openedAt ?? null,
        closed_at: trade.closedAt ?? null,
        additional_context: trade.context ?? null,
      }
    : {
        token: trade.token,
        strategy: trade.strategy,
        entry_price: trade.entryPrice ?? null,
        exit_price: trade.exitPrice ?? null,
        position_size_sol: trade.sizeSol ?? null,
        realized_pnl_sol: trade.pnlSol,
        hold_time_minutes: holdMinutes,
        opened_at: trade.openedAt ?? null,
        closed_at: trade.closedAt ?? null,
        additional_context: trade.context ?? null,
      };

  const result = await llmJson<LossAnalysis>({
    system: isRobinhood ? ROBINHOOD_SYSTEM_PROMPT : SOLANA_SYSTEM_PROMPT,
    user: `Post-mortem this losing trade:\n\n${JSON.stringify(record, null, 2)}`,
    schema: isRobinhood ? ROBINHOOD_ANALYSIS_SCHEMA : ANALYSIS_SCHEMA,
    schemaName: "loss_analysis",
    maxTokens: 4000,
  });

  result.suggestedConfig = sanitizeSuggestedConfigForChain(result.suggestedConfig, trade.chain);

  return result;
}
