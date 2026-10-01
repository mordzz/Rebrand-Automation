import type { TradeRow } from "@/components/dashboard/trade-performance-chart";
import { nativeSymbolFor, rowPnl } from "@/lib/chain/display";
import { cn } from "@/lib/utils";

const TABLE_HEAD =
  "px-4 py-3 text-[0.65rem] font-semibold tracking-[0.15em] uppercase";

/** Signed amount in an explicit native unit — callers pass the row's own
 * chain unit (lib/chain/display.ts), never assume SOL (PR14). */
export function formatSignedNative(n: number, symbol: string, decimals = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)} ${symbol}`;
}

/** Closed-trade table with per-trade realized PnL — shared by the house
 * desk (dashboard) and a connected account's own desk (deploy). Callers
 * own the surrounding card chrome so this fits either a Tabs panel or a
 * plain labeled section. */
export function TradeHistoryTable({
  trades,
  configured,
}: {
  trades: TradeRow[];
  configured: boolean;
}) {
  return (
    <table className="w-full min-w-[560px] text-sm">
      <thead>
        <tr className="border-b border-white/5 text-left text-muted-foreground">
          <th className={TABLE_HEAD}>Closed</th>
          <th className={TABLE_HEAD}>Token</th>
          <th className={TABLE_HEAD}>Strategy</th>
          <th className={TABLE_HEAD}>Note</th>
          <th className={cn(TABLE_HEAD, "text-right")}>Result</th>
        </tr>
      </thead>
      <tbody>
        {!configured ? (
          <tr>
            <td
              colSpan={5}
              className="px-4 py-8 text-center text-sm text-muted-foreground"
            >
              Connect DATABASE_URL to see trade history.
            </td>
          </tr>
        ) : trades.length === 0 ? (
          <tr>
            <td
              colSpan={5}
              className="px-4 py-8 text-center text-sm text-muted-foreground"
            >
              No closed trades yet.
            </td>
          </tr>
        ) : (
          trades.map((h) => {
            const pnl = rowPnl(h) ?? 0;
            const symbol = nativeSymbolFor(h);
            return (
              <tr
                key={h.id}
                className="border-b border-white/5 transition-colors last:border-b-0 hover:bg-accent/[0.03]"
              >
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                  {new Date(h.closedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-3 font-medium">${h.token}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {h.strategy}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {h.context?.exitReason ?? "—"}
                </td>
                <td
                  className={cn(
                    "px-4 py-3 text-right font-mono text-[0.8rem] font-medium",
                    pnl >= 0 ? "text-sol-green-ink" : "text-destructive"
                  )}
                >
                  {formatSignedNative(pnl, symbol, symbol === "ETH" ? 5 : 3)}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
