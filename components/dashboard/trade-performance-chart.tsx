"use client";

import { ChartSpline } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { isRobinhoodRow, rowPnl } from "@/lib/chain/display";

export type TradeRow = {
  id: string;
  token: string;
  strategy: string;
  pnlSol: string;
  /** PR04 chain-neutral fields — pick the unit per row (PR14). */
  chain?: string | null;
  pnlNative?: string | null;
  closedAt: string;
  context: { exitReason?: string } | null;
};

/* Trade-performance chart colors: the desk's P&L status pair for the bars
   (sign is also encoded by bar direction from the zero line, never color
   alone) and the cream chart-1 token for the cumulative curve. */
const PERF_CONFIG = {
  pnl: { label: "Per-trade P&L", color: "var(--sol-green)" },
  cum: { label: "Cumulative", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Per-trade realized P&L bars + a cumulative curve — shared by the house
 * desk (dashboard) and a connected account's own desk (deploy). */
export function TradePerformanceChart({
  trades,
  configured,
}: {
  trades: TradeRow[];
  configured: boolean;
}) {
  // Chronological series — the API returns newest-first, so re-sort
  // ascending before accumulating (via reduce, not a mutated loop
  // variable, so the render body stays pure).
  // One unit per chart: Robinhood (ETH) rows if any exist, otherwise the
  // historical Solana (SOL) rows. ETH and SOL are never summed together.
  const hasRobinhood = trades.some(isRobinhoodRow);
  const unit = hasRobinhood ? "ETH" : "SOL";
  const perfSeries = trades
    .filter((t) => isRobinhoodRow(t) === hasRobinhood)
    .sort(
      (a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
    )
    .reduce<
      { label: string; token: string; pnl: number; cum: number }[]
    >((acc, t) => {
      const pnl = rowPnl(t) ?? 0;
      const prevCum = acc.length > 0 ? acc[acc.length - 1].cum : 0;
      acc.push({
        label: new Date(t.closedAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        token: t.token,
        pnl,
        cum: Number((prevCum + pnl).toFixed(6)),
      });
      return acc;
    }, []);

  return (
    <div className="m-1 mt-0 rounded-xl bg-secondary px-4 py-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <ChartSpline className="size-3.5" />
        <p className="text-[0.65rem] font-semibold tracking-[0.15em] uppercase">
          Trade performance · Realized P&L ({unit})
        </p>
      </div>
      {!configured ? (
        <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
          Connect DATABASE_URL to chart trade performance.
        </div>
      ) : perfSeries.length === 0 ? (
        <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
          No closed trades yet — the curve draws itself as the agent trades.
        </div>
      ) : (
        <ChartContainer config={PERF_CONFIG} className="mt-3 h-44 w-full">
          <ComposedChart data={perfSeries} margin={{ left: 4, right: 12, top: 4 }}>
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
              tick={{ fontSize: 11 }}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              tick={{ fontSize: 11 }}
            />
            <ReferenceLine y={0} stroke="var(--border)" />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="pnl" radius={2} maxBarSize={18}>
              {perfSeries.map((p, i) => (
                <Cell
                  key={i}
                  fill={p.pnl >= 0 ? "var(--sol-green)" : "var(--destructive)"}
                />
              ))}
            </Bar>
            <Line
              dataKey="cum"
              type="monotone"
              stroke="var(--color-cum)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ChartContainer>
      )}
    </div>
  );
}
