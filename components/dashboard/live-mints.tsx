"use client";

import {
  Check,
  Copy,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type MintEvent = {
  mint: string;
  name: string;
  symbol: string;
  initialMcapSol?: number;
  currentMcapSol?: number;
  solAmount?: number;
  pool?: string;
  receivedAt: number;
  devPct?: number;
  risky: boolean;
  reasons: string[];
};

type StreamStatus = "connecting" | "live" | "offline";

/** pump.fun tokens are minted with a fixed 1B supply */
const TOTAL_SUPPLY = 1_000_000_000;

/** Exact-symbol impersonations of majors — instant red flag */
const IMPERSONATED = new Set([
  "USDC",
  "USDT",
  "SOL",
  "WSOL",
  "BTC",
  "ETH",
  "BONK",
  "WIF",
  "JUP",
  "PUMP",
]);

/** Auto-generated Mayhem launches — never ingested at all */
function isMayhem(data: { name?: string; symbol?: string; pool?: string }) {
  return (
    data.pool === "mayhem" ||
    /mayhem/i.test(`${data.name ?? ""} ${data.symbol ?? ""}`)
  );
}

function assess(data: {
  name?: string;
  symbol?: string;
  uri?: string;
  solAmount?: number;
  initialBuy?: number;
}): Pick<MintEvent, "devPct" | "risky" | "reasons"> {
  const reasons: string[] = [];
  const name = (data.name ?? "").trim();
  const symbol = (data.symbol ?? "").trim();

  const devPct =
    typeof data.initialBuy === "number"
      ? (data.initialBuy / TOTAL_SUPPLY) * 100
      : undefined;

  if (devPct !== undefined && devPct > 10) {
    reasons.push(`dev holds ${devPct.toFixed(1)}% of supply`);
  }
  if (typeof data.solAmount === "number" && data.solAmount < 0.05) {
    reasons.push("dev buy under 0.05 SOL");
  }
  if (!data.uri) {
    reasons.push("missing metadata");
  }
  if (name.length < 3 || symbol.length < 2) {
    reasons.push("low-effort name");
  }
  if (/https?:\/\/|t\.me|\.com|\.io|\.xyz/i.test(`${name} ${symbol}`)) {
    reasons.push("link in name");
  }
  if (/\btest\b/i.test(name) || /^test/i.test(symbol)) {
    reasons.push("test token");
  }
  if (IMPERSONATED.has(symbol.toUpperCase())) {
    reasons.push(`impersonates ${symbol.toUpperCase()}`);
  }

  return { devPct, risky: reasons.length > 0, reasons };
}

function timeAgo(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function fmtUsdCompact(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPrice(usd: number) {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.001) return `$${usd.toFixed(4)}`;
  const decimals = Math.min(12, Math.ceil(-Math.log10(usd)) + 2);
  return `$${usd.toFixed(decimals)}`;
}

export function LiveMints() {
  const [mints, setMints] = useState<MintEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [copiedMint, setCopiedMint] = useState<string | null>(null);
  const retries = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const mintsRef = useRef<MintEvent[]>([]);
  const subscribedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mintsRef.current = mints;
  }, [mints]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, []);

  // SOL/USD price, refreshed every minute
  useEffect(() => {
    let disposed = false;
    async function fetchPrice() {
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
        );
        const json = await res.json();
        const price = json?.solana?.usd;
        if (!disposed && typeof price === "number") setSolUsd(price);
      } catch {
        // keep last known price
      }
    }
    fetchPrice();
    const interval = setInterval(fetchPrice, 60_000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout>;
    let disposed = false;

    function connect() {
      setStatus("connecting");
      ws = new WebSocket("wss://pumpportal.fun/api/data");
      wsRef.current = ws;

      ws.onopen = () => {
        retries.current = 0;
        setStatus("live");
        ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
        // after a reconnect, resubscribe to trades of tokens already listed
        const keys = mintsRef.current.map((m) => m.mint);
        subscribedRef.current = new Set(keys);
        if (keys.length) {
          ws?.send(JSON.stringify({ method: "subscribeTokenTrade", keys }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);

          if (data?.txType === "create" && data.mint) {
            if (isMayhem(data)) return;
            const item: MintEvent = {
              mint: data.mint,
              name: data.name || "Unnamed",
              symbol: data.symbol || "?",
              initialMcapSol: data.marketCapSol,
              currentMcapSol: data.marketCapSol,
              solAmount: data.solAmount,
              pool: data.pool,
              receivedAt: Date.now(),
              ...assess(data),
            };
            setMints((prev) =>
              prev.some((p) => p.mint === item.mint)
                ? prev
                : [item, ...prev].slice(0, 60)
            );
            return;
          }

          // live trades for tokens already on the list → track mcap
          if (
            (data?.txType === "buy" || data?.txType === "sell") &&
            data.mint &&
            typeof data.marketCapSol === "number"
          ) {
            setMints((prev) =>
              prev.map((m) =>
                m.mint === data.mint
                  ? { ...m, currentMcapSol: data.marketCapSol }
                  : m
              )
            );
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus("offline");
        const delay = Math.min(15000, 1500 * 2 ** retries.current++);
        reconnect = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      ws?.close();
    };
  }, []);

  // keep trade subscriptions in sync with the visible list
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const current = new Set(mints.map((m) => m.mint));
    const toSub = [...current].filter((m) => !subscribedRef.current.has(m));
    const toUnsub = [...subscribedRef.current].filter((m) => !current.has(m));
    if (toSub.length) {
      ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: toSub }));
      toSub.forEach((m) => subscribedRef.current.add(m));
    }
    if (toUnsub.length) {
      ws.send(
        JSON.stringify({ method: "unsubscribeTokenTrade", keys: toUnsub })
      );
      toUnsub.forEach((m) => subscribedRef.current.delete(m));
    }
  }, [mints]);

  async function copyCa(mint: string) {
    try {
      await navigator.clipboard.writeText(mint);
      setCopiedMint(mint);
      setTimeout(() => setCopiedMint((c) => (c === mint ? null : c)), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  const visible = showAll ? mints : mints.filter((m) => !m.risky);
  const filteredCount = mints.filter((m) => m.risky).length;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-sm font-medium">Live token creations</p>
          <p className="text-xs text-muted-foreground">
            Streamed from pump.fun via PumpPortal · {filteredCount} rug-risk
            mint{filteredCount === 1 ? "" : "s"} filtered
            {solUsd ? ` · SOL $${solUsd.toFixed(0)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-full bg-muted p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className={cn(
                "rounded-full px-3 py-1 font-medium transition-colors",
                !showAll
                  ? "bg-background text-foreground"
                  : "text-muted-foreground"
              )}
            >
              Alpha only
            </button>
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className={cn(
                "rounded-full px-3 py-1 font-medium transition-colors",
                showAll
                  ? "bg-background text-foreground"
                  : "text-muted-foreground"
              )}
            >
              All
            </button>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground capitalize">
            <span
              className={cn(
                "inline-block size-1.5 rounded-full",
                status === "live" && "bg-emerald-600",
                status === "connecting" && "bg-accent animate-blink",
                status === "offline" && "bg-destructive"
              )}
            />
            {status}
          </span>
        </div>
      </div>

      <div className="max-h-[26rem] overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {status === "offline"
              ? "Stream unavailable — retrying…"
              : mints.length > 0
                ? "Nothing passing the alpha filter yet — new mints are being screened…"
                : "Listening for new mints…"}
          </p>
        ) : (
          <ul>
            {visible.map((m) => {
              const mcapUsd =
                solUsd && typeof m.currentMcapSol === "number"
                  ? m.currentMcapSol * solUsd
                  : null;
              const priceUsd = mcapUsd !== null ? mcapUsd / TOTAL_SUPPLY : null;
              const changePct =
                typeof m.initialMcapSol === "number" &&
                typeof m.currentMcapSol === "number" &&
                m.initialMcapSol > 0
                  ? ((m.currentMcapSol - m.initialMcapSol) / m.initialMcapSol) *
                    100
                  : null;

              return (
                <li
                  key={m.mint}
                  className={cn(
                    "flex items-center gap-3 border-b px-4 py-3 first:animate-fade-up last:border-b-0",
                    m.risky && "opacity-60"
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0",
                      m.risky ? "text-destructive" : "text-emerald-700"
                    )}
                    title={m.risky ? m.reasons.join(", ") : "Passed all checks"}
                  >
                    {m.risky ? (
                      <ShieldAlert className="size-4" />
                    ) : (
                      <ShieldCheck className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      ${m.symbol}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {m.name}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {m.mint.slice(0, 4)}…{m.mint.slice(-4)}
                      {m.pool ? ` · ${m.pool}` : ""}
                      {m.risky ? (
                        <span className="text-destructive">
                          {" "}
                          · {m.reasons.join(" · ")}
                        </span>
                      ) : (
                        typeof m.devPct === "number" && (
                          <span> · dev {m.devPct.toFixed(1)}%</span>
                        )
                      )}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-sm font-medium">
                      {mcapUsd !== null ? fmtUsdCompact(mcapUsd) : "—"}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        mcap
                      </span>
                      {changePct !== null && (
                        <span
                          className={cn(
                            "ml-2 text-xs font-semibold",
                            changePct >= 0
                              ? "text-emerald-700"
                              : "text-destructive"
                          )}
                        >
                          {changePct >= 0 ? "+" : ""}
                          {changePct.toFixed(1)}%
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {priceUsd !== null ? fmtPrice(priceUsd) : "price —"}
                    </p>
                  </div>
                  <div className="w-14 text-right text-xs text-muted-foreground">
                    {timeAgo(m.receivedAt, now)}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyCa(m.mint)}
                    aria-label={`Copy ${m.symbol} contract address`}
                    title="Copy CA"
                    className="text-muted-foreground transition-colors hover:text-accent"
                  >
                    {copiedMint === m.mint ? (
                      <Check className="size-4 text-emerald-700" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                  <a
                    href={`https://pump.fun/coin/${m.mint}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${m.symbol} on pump.fun`}
                    className="text-muted-foreground transition-colors hover:text-accent"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
