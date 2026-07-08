import Anthropic from "@anthropic-ai/sdk";

export type LossAnalysis = {
  cause: string;
  lesson: string;
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
  },
  required: ["cause", "lesson"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are the risk analyst of an automated Solana memecoin trading desk. After every losing trade you perform the post-mortem.

You receive the full record of one closed losing trade. Diagnose the primary failure mode — for example: entered too late after launch, stayed in the position too long, take-profit too slow or too greedy, stop-loss too tight or missing, rug/liquidity drain, copied a bad wallet, oversized position. Then distill exactly one reusable rule the trading engine can enforce on future trades.

Be specific and quantitative where the data allows it (use the actual hold time, drawdown, or percentages from the trade record). Never blame "market conditions" alone — always find the controllable factor.`;

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
