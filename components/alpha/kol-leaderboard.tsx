"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  Send,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";

import { TokenIcon } from "@/components/token-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type KolPosition = {
  id: string;
  mint: string;
  symbol: string | null;
  tokenLogo: string | null;
  tokenTwitter: string | null;
  tokenWebsite: string | null;
  tokenTelegram: string | null;
  status: "open" | "closed";
  enteredAt: number;
  exitedAt: number | null;
  entryMarketCapUsd: number | null;
  exitMarketCapUsd: number | null;
  pnlUsd: number | null;
  /** Live on-chain fact, not derived from the trade window — see
   * lib/gmgn/wallet-holdings.ts. Can be non-null even on a "closed"
   * position: that just means the pairing saw a sell, not that the
   * wallet sold everything. */
  supplyPct: number | null;
  holdingValueUsd: number | null;
};

type KolRow = {
  wallets: string[];
  traderName: string;
  traderHandle: string | null;
  avatarUrl: string | null;
  lastActiveAt: number;
  winRate: number | null;
  realizedProfitUsd7d: number | null;
  tokenCount7d: number | null;
  followersCount: number | null;
  positions: KolPosition[];
};

type KolsResponse = {
  configured: boolean;
  data: KolRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function usePolledJson<T>(url: string, intervalMs: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const res = await fetch(url);
        const json = (await res.json()) as T;
        if (!disposed) setData(json);
      } catch {
        // keep whatever we already have
      }
    }
    load();
    const interval = setInterval(load, intervalMs);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [url, intervalMs]);
  return data;
}

function timeAgo(unixSec: number, now: number): string {
  const s = Math.max(0, Math.round(now / 1000 - unixSec));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function formatUsd(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

const HEAD_CELL =
  "px-3 py-2 text-left text-[0.6rem] font-semibold tracking-[0.12em] uppercase text-muted-foreground";

/** One tracked KOL per section — not one row per position, so an account
 * with several buys doesn't repeat its own identity down the table.
 * Win rate / realized PnL / follower count come straight from GMGN's own
 * wallet_stats (7d, computed across that wallet's full history), while
 * each listed position's entry/exit/market-cap/PnL comes from pairing
 * this account's own recent buy/sell trades — see
 * lib/gmgn/kol-positions.ts for both derivations. Complements
 * smart-money-panel.tsx (the raw chronological feed, KOL + smart money
 * together) rather than replacing it. */
export function KolLeaderboard() {
  const [page, setPage] = useState(1);
  const response = usePolledJson<KolsResponse>(`/api/alpha/kols?page=${page}`, 35_000);
  const [now, setNow] = useState(() => Date.now());
  const [copiedMint, setCopiedMint] = useState<string | null>(null);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, []);

  async function copyMint(mint: string) {
    try {
      await navigator.clipboard.writeText(mint);
      setCopiedMint(mint);
      setTimeout(() => setCopiedMint((c) => (c === mint ? null : c)), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  if (response && !response.configured) {
    return (
      <div className="overflow-hidden rounded-2xl bg-card">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Users className="size-4" />
          </span>
          <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            KOL Positions
          </p>
        </div>
        <div className="border-t border-white/5 px-4 py-8 text-center text-sm text-muted-foreground">
          Tracked-account activity isn&apos;t wired up in this environment yet.
        </div>
      </div>
    );
  }

  const kols = response?.data ?? [];
  const total = response?.total ?? 0;
  const totalPages = response?.totalPages ?? 1;
  const currentPage = response?.page ?? page;

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Users className="size-4" />
          </span>
          <div>
            <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
              KOL Positions
            </p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-[0.7rem] font-medium tracking-[0.15em] uppercase text-muted-foreground">
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              response ? "bg-sol-green" : "bg-muted-foreground/40 animate-blink"
            )}
          />
          {response ? "live" : "connecting"}
        </span>
      </div>

      {kols.length === 0 ? (
        <p className="border-t border-white/5 px-4 py-12 text-center text-sm text-muted-foreground">
          {response ? "No tracked account activity right now." : "Loading…"}
        </p>
      ) : (
        <ul className="divide-y divide-white/5 border-t border-white/5">
          {kols.map((kol) => (
            <li key={kol.wallets[0]} className="px-4 py-4">
              {/* KOL header: identity + GMGN's own account-level record */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <TokenIcon src={kol.avatarUrl} symbol={kol.traderName} className="size-10" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{kol.traderName}</p>
                    {kol.traderHandle && (
                      <a
                        href={`https://x.com/${kol.traderHandle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-xs text-muted-foreground hover:text-accent hover:underline"
                      >
                        @{kol.traderHandle}
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">
                    Win rate (7d){" "}
                    <span
                      className={cn(
                        "font-medium",
                        kol.winRate == null
                          ? "text-muted-foreground"
                          : kol.winRate >= 0.5
                            ? "text-sol-green-ink"
                            : "text-destructive"
                      )}
                    >
                      {kol.winRate != null ? `${(kol.winRate * 100).toFixed(0)}%` : "—"}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    P&amp;L (7d){" "}
                    <span
                      className={cn(
                        "font-medium",
                        kol.realizedProfitUsd7d == null
                          ? "text-muted-foreground"
                          : kol.realizedProfitUsd7d > 0
                            ? "text-sol-green-ink"
                            : kol.realizedProfitUsd7d < 0
                              ? "text-destructive"
                              : "text-muted-foreground"
                      )}
                    >
                      {kol.realizedProfitUsd7d != null
                        ? `${kol.realizedProfitUsd7d > 0 ? "+" : ""}${formatUsd(kol.realizedProfitUsd7d)}`
                        : "—"}
                    </span>
                  </span>
                  {kol.followersCount != null && (
                    <span className="text-muted-foreground">
                      {formatCount(kol.followersCount)} followers
                    </span>
                  )}
                  {kol.tokenCount7d != null && (
                    <span className="text-muted-foreground">
                      {kol.tokenCount7d} tokens (7d)
                    </span>
                  )}
                </div>

                <span className="ml-auto shrink-0 text-[0.65rem] text-muted-foreground">
                  active {timeAgo(kol.lastActiveAt, now)}
                </span>
              </div>

              {/* This account's own tokens, from the trade window this page shares */}
              <div className="mt-3 overflow-x-auto rounded-xl bg-secondary">
                <table className="w-full min-w-[960px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className={HEAD_CELL}>Token</th>
                      <th className={HEAD_CELL}>Socials</th>
                      <th className={cn(HEAD_CELL, "text-right")}>Entered</th>
                      <th className={cn(HEAD_CELL, "text-right")}>Exited</th>
                      <th className={cn(HEAD_CELL, "text-right")}>Entry MC</th>
                      <th className={cn(HEAD_CELL, "text-right")}>Exit / now MC</th>
                      <th className={cn(HEAD_CELL, "text-right")}>Holding</th>
                      <th className={cn(HEAD_CELL, "text-right")}>P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kol.positions.map((p) => (
                      <tr key={p.id} className="border-t border-white/5">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <TokenIcon src={p.tokenLogo} symbol={p.symbol} className="size-6" />
                            <span className="truncate text-xs font-medium">
                              ${p.symbol ?? "?"}
                            </span>
                            <span className="font-mono text-[0.7rem] text-muted-foreground">
                              {shortMint(p.mint)}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyMint(p.mint)}
                              aria-label="Copy contract address"
                              title="Copy CA"
                              className="text-muted-foreground transition-colors hover:text-accent"
                            >
                              {copiedMint === p.mint ? (
                                <Check className="text-sol-green-ink size-3" />
                              ) : (
                                <Copy className="size-3" />
                              )}
                            </button>
                          </div>
                        </td>

                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            {p.tokenTwitter && (
                              <a
                                href={
                                  p.tokenTwitter.startsWith("http")
                                    ? p.tokenTwitter
                                    : `https://x.com/${p.tokenTwitter}`
                                }
                                target="_blank"
                                rel="noreferrer"
                                aria-label="Token X"
                                className="hover:text-accent"
                              >
                                <ExternalLink className="size-3.5" />
                              </a>
                            )}
                            {p.tokenWebsite && (
                              <a
                                href={p.tokenWebsite}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="Token website"
                                className="hover:text-accent"
                              >
                                <Globe className="size-3.5" />
                              </a>
                            )}
                            {p.tokenTelegram && (
                              <a
                                href={
                                  p.tokenTelegram.startsWith("http")
                                    ? p.tokenTelegram
                                    : `https://t.me/${p.tokenTelegram}`
                                }
                                target="_blank"
                                rel="noreferrer"
                                aria-label="Token Telegram"
                                className="hover:text-accent"
                              >
                                <Send className="size-3.5" />
                              </a>
                            )}
                            {!p.tokenTwitter && !p.tokenWebsite && !p.tokenTelegram && "—"}
                          </div>
                        </td>

                        <td className="px-3 py-2 text-right text-xs whitespace-nowrap text-muted-foreground">
                          {timeAgo(p.enteredAt, now)}
                        </td>

                        <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                          {p.status === "open" ? (
                            <span className="text-sol-green-ink font-medium">Still open</span>
                          ) : (
                            <span className="text-muted-foreground">
                              {timeAgo(p.exitedAt as number, now)}
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.entryMarketCapUsd != null ? formatUsd(p.entryMarketCapUsd) : "—"}
                        </td>

                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.exitMarketCapUsd != null ? (
                            formatUsd(p.exitMarketCapUsd)
                          ) : (
                            <span className="text-xs text-muted-foreground">not priced yet</span>
                          )}
                        </td>

                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.supplyPct != null || p.holdingValueUsd != null ? (
                            <>
                              {p.supplyPct != null && (
                                <span>
                                  {p.supplyPct > 0 && p.supplyPct < 0.01
                                    ? "<0.01"
                                    : p.supplyPct.toFixed(2)}
                                  %
                                </span>
                              )}
                              {p.holdingValueUsd != null && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  {formatUsd(p.holdingValueUsd)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>

                        <td
                          className={cn(
                            "px-3 py-2 text-right tabular-nums font-medium",
                            p.pnlUsd == null && "text-muted-foreground",
                            p.pnlUsd != null && p.pnlUsd > 0 && "text-sol-green-ink",
                            p.pnlUsd != null && p.pnlUsd < 0 && "text-destructive"
                          )}
                        >
                          {p.pnlUsd != null ? (
                            <>
                              {p.pnlUsd > 0 ? "+" : ""}
                              {formatUsd(p.pnlUsd)}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {kols.length} of {total} accounts &middot; page {currentPage} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page of KOLs"
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              aria-label="Next page of KOLs"
            >
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
