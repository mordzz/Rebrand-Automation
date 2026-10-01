"use client";

import { Brain } from "lucide-react";
import { useEffect, useState } from "react";

import { nativeSymbolFor, rowPnl } from "@/lib/chain/display";
import { cn } from "@/lib/utils";

/** Shape of a row returned by GET /api/lessons */
type LessonApiRow = {
  id: string;
  cause: string;
  lesson: string;
  status: string;
  suggestedConfig: Record<string, unknown> | null;
  createdAt: string;
  token: string | null;
  strategy: string | null;
  pnlNative?: string | null;
  chain?: string | null;
  closedAt: string | null;
};

type LessonsResponse = { configured: boolean; data: LessonApiRow[] };

function formatDate(row: LessonApiRow): string {
  return new Date(row.closedAt ?? row.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Compact agent memory: what a bot lost on, why, and the rule it wrote
 * from it.
 *
 * Deliberately a card list rather than the dashboard's seven-column table
 * (components/dashboard/llm-connections.tsx) - that table needs ~860px to
 * breathe, and this renders inside a column roughly half that wide. Same
 * data, laid out for the space it actually has.
 */
export function AgentMemory({
  endpoint = "/api/lessons",
  emptyHint = "No lessons yet - the first losing trade will be analysed and stored here.",
}: {
  endpoint?: string;
  emptyHint?: string;
} = {}) {
  const [response, setResponse] = useState<LessonsResponse | null>(null);

  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const res = await fetch(endpoint);
        const json = (await res.json()) as LessonsResponse;
        if (!disposed) setResponse(json);
      } catch {
        // keep the last good value
      }
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [endpoint]);

  const rows = response?.data ?? [];
  const live = Boolean(response?.configured);

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Brain className="size-4" />
          </span>
          <div>
            <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
              Agent Memory
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every loss analysed and stored as a rule.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {rows.length} lesson{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {!live ? (
        <p className="border-t border-white/5 px-4 py-8 text-center text-sm text-muted-foreground">
          {response ? "Connect DATABASE_URL to see agent memory." : "Loading…"}
        </p>
      ) : rows.length === 0 ? (
        <p className="border-t border-white/5 px-4 py-8 text-center text-sm text-muted-foreground">
          {emptyHint}
        </p>
      ) : (
        <ul className="max-h-80 overflow-y-auto border-t border-white/5">
          {rows.map((row) => {
            const pnl = rowPnl(row) ?? 0;
            const symbol = nativeSymbolFor(row);
            const applied = row.status === "applied";
            return (
              <li key={row.id} className="border-b border-white/5 px-4 py-3 last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium">
                    ${row.token ?? "-"}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {row.strategy ?? "-"}
                    </span>
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-destructive text-xs font-medium tabular-nums">
                      {pnl > 0 ? "+" : ""}
                      {pnl.toFixed(symbol === "ETH" ? 5 : 4)} {symbol}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[0.6rem] font-medium tracking-wide uppercase",
                        applied
                          ? "bg-accent/10 text-accent"
                          : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {applied ? "applied" : "learning"}
                    </span>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  <span className="text-foreground/70">Why:</span> {row.cause}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="text-foreground/70">Lesson:</span> {row.lesson}
                </p>
                <p className="mt-1 text-[0.65rem] text-muted-foreground/60">
                  {formatDate(row)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
