import Anthropic from "@anthropic-ai/sdk";

/**
 * The only SniperConfig keys a post-mortem is allowed to propose changing —
 * a fixed, explicit set (not an open dictionary) so the model can't invent
 * nonsense fields or touch the safety-critical ones (max SOL per snipe,
 * concurrent-position caps, circuit breaker) without a human authoring that
 * change directly. Mirrors lib/sniper/config.ts#SniperConfig.
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
  maxCreatorBuyPct: number;
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
  sizeSol?: number | string | null;
  pnlSol: number | string;
  openedAt?: string | null;
  closedAt?: string | null;
  context?: Record<string, unknown> | null;
};

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
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
    suggestedConfig: {
      type: ["object", "null"],
      description:
        "A concrete change to the Sniper's live trading config that would have prevented this specific loss, using ONLY the fields below — omit any field you aren't changing, and return null entirely if no clean config change applies (e.g. the loss was a pure rug no config knob could have caught in time).",
      properties: {
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
        maxCreatorBuyPct: {
          type: "number",
          description: "Reject a snipe if the creator's own initial buy exceeds this percent of supply.",
        },
        cooldownAfterLossSec: {
          type: "number",
          description: "Seconds to pause new entries after any closed loss.",
        },
      },
      additionalProperties: false,
    },
  },
  required: ["cause", "lesson", "suggestedConfig"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are the risk analyst of an automated Solana memecoin trading desk. After every losing trade you perform the post-mortem.

You receive the full record of one closed losing trade. Diagnose the primary failure mode — for example: entered too late after launch, stayed in the position too long, take-profit too slow or too greedy, stop-loss too tight or missing, rug/liquidity drain, copied a bad wallet, oversized position. Then distill exactly one reusable rule the trading engine can enforce on future trades.

Be specific and quantitative where the data allows it (use the actual hold time, drawdown, or percentages from the trade record). Never blame "market conditions" alone — always find the controllable factor.

Additionally, if this loss's specific cause maps cleanly onto one of the config fields you're given, propose the exact change as suggestedConfig — a human reviews and approves every suggestion before it's applied, so err toward proposing a change whenever you have real evidence for one rather than leaving it null out of caution. Only return null when the loss was genuinely not addressable by these knobs (e.g. an instant rug that no timing or stop distance could have caught).`;

/**
 * Ask Claude to diagnose a losing trade and produce a reusable rule.
 * Throws if the API is not configured or the call fails; callers decide
 * how to degrade.
 */
export async function analyzeLoss(
  trade: ClosedTradeInput
): Promise<LossAnalysis> {
  const client = new Anthropic();

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
    entry_price: trade.entryPrice ?? null,
    exit_price: trade.exitPrice ?? null,
    position_size_sol: trade.sizeSol ?? null,
    realized_pnl_sol: trade.pnlSol,
    hold_time_minutes: holdMinutes,
    opened_at: trade.openedAt ?? null,
    closed_at: trade.closedAt ?? null,
    additional_context: trade.context ?? null,
  };

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    output_config: {
      format: {
        type: "json_schema",
        schema: ANALYSIS_SCHEMA,
      },
    },
    messages: [
      {
        role: "user",
        content: `Post-mortem this losing trade:\n\n${JSON.stringify(record, null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Analysis was refused by the model");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No analysis text in model response");
  }

  return JSON.parse(textBlock.text) as LossAnalysis;
}
