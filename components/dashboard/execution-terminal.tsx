"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Level = "info" | "buy" | "sell" | "guard" | "warn" | "error";

type LogRow = {
  id: string;
  level: string;
  source: string;
  message: string;
  txSignature: string | null;
  createdAt: string;
};

/* Warm terminal palette, fixed regardless of the site's light/dark theme */
const LEVEL_COLOR: Record<Level, string> = {
  info: "#a8a094",
  buy: "#7faE6f",
  sell: "#e0a862",
  guard: "#b07aff",
  warn: "#cfa54e",
  error: "#e0714f",
};

const LEVEL_TAG: Record<Level, string> = {
  info: "INFO",
  buy: "FILL",
  sell: "EXIT",
  guard: "GUARD",
  warn: "WARN",
  error: "ERR",
};

function asLevel(value: string): Level {
  return value in LEVEL_COLOR ? (value as Level) : "info";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}

const EMPTY_ROWS: LogRow[] = [];

export function ExecutionTerminal() {
  const [logsData, setLogsData] = useState<{
    configured: boolean;
    data: LogRow[];
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Real events from the sniper daemon (and future sources) — fast polling
  // rather than a fake generator. See lib/logs.ts for what actually writes here.
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const res = await fetch("/api/logs");
        const json = await res.json();
        if (!disposed) setLogsData(json);
      } catch {
        // keep whatever we already have
      }
    }
    load();
    const interval = setInterval(load, 3_000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, []);

  const rows = logsData?.data ?? EMPTY_ROWS;

  // Keep pinned to the bottom unless the user scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [rows]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-[#161512]">
      {/* Title bar */}
      <div className="flex items-center justify-between bg-black/25 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#e0714f]" />
            <span className="size-2.5 rounded-full bg-[#cfa54e]" />
            <span className="size-2.5 rounded-full bg-[#7faE6f]" />
          </div>
          <p className="font-mono text-xs text-[#a8a094]">
            noah@enginex — execution.log
          </p>
        </div>
        <span className="flex items-center gap-1.5 font-mono text-xs text-[#a8a094]">
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              logsData?.configured ? "animate-blink bg-[#7faE6f]" : "bg-[#6f6a5f]"
            )}
          />
          {logsData?.configured ? "live" : "offline"}
        </span>
      </div>

      {/* Log stream */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-80 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed"
      >
        {!logsData?.configured ? (
          <p className="text-[#a8a094]">
            Connect DATABASE_URL to see live execution logs.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-[#a8a094]">
            No log entries yet — start the Raven daemon (`npm run sniper`) to
            see live activity.
          </p>
        ) : (
          rows.map((row) => {
            const level = asLevel(row.level);
            return (
              <div key={row.id} className="flex gap-3 py-0.5 first:animate-fade-up">

                <span className="shrink-0 text-[#6f6a5f]">
                  {formatTime(row.createdAt)}
                </span>
                <span
                  className="w-11 shrink-0 font-semibold"
                  style={{ color: LEVEL_COLOR[level] }}
                >
                  {LEVEL_TAG[level]}
                </span>
                <span className="min-w-0 flex-1 break-words text-[#d8d2c4]">
                  {row.message}
                  {row.txSignature && row.txSignature !== "dry-run" && (
                    <a
                      href={`https://solscan.io/tx/${row.txSignature}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-flex items-center gap-1 text-[#b07aff] hover:underline"
                    >
                      {row.txSignature.slice(0, 8)}…{row.txSignature.slice(-8)}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </span>
              </div>
            );
          })
        )}
        <div className="flex gap-2 pt-1 text-[#d8d2c4]">
          <span className="text-[#7faE6f]">noah ▸</span>
          <span className="inline-block w-2 animate-blink bg-[#d8d2c4]">&nbsp;</span>
        </div>
      </div>
    </section>
  );
}
