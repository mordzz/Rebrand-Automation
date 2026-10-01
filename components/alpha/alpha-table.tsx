"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

import { TokenIcon } from "@/components/token-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { explorerUrl } from "@/lib/chain/config";

/** Mirrors lib/sniper/safety-checks.ts#SafetyCheckResult - kept as a plain
 * type here (not imported) since this file is a client component and the
 * source type lives in server-only code (same convention as
 * components/dashboard/sniper-config-readout.tsx). */
type SafetyMetadata = {
  name?: string;
  symbol?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

type SafetyResult = {
  passed: boolean;
  reasons: string[];
  /* Solana (historical) facts */
  mintAuthorityRenounced?: boolean | null;
  freezeAuthorityRenounced?: boolean | null;
  creatorBuyPct?: number | null;
  /* Robinhood/EVM facts (lib/gmgn/safety-robinhood.ts) */
  ownerRenounced?: boolean | null;
  isBlacklistCapable?: boolean | null;
  creatorHoldPct?: number | null;
  hasSocialLink: boolean | null;
  alphaWalletDetected: boolean | null;
  matchedAlphaWallets: string[];
  metadata: SafetyMetadata | null;
};

/** Live figures from DexScreener, added per row by app/api/alpha - see
 * lib/sniper/token-market.ts. Null for a mint with no pair yet. */
type TokenMarket = {
  marketCapUsd: number | null;
  priceUsd: number | null;
  changePct: number | null;
  /** Which window changePct covers - a minutes-old mint usually only has
   * a 24h figure, so the row labels the window instead of implying "5m". */
  changeWindow: "5m" | "1h" | "6h" | "24h" | null;
  volumeH24Usd: number | null;
};

type AlphaCandidateRow = {
  id: string;
  /** "robinhood" for the active feed; absent on historical Solana rows. */
  chain?: "robinhood";
  token: string;
  symbol: string | null;
  name: string | null;
  ageSec: string | number;
  creatorBuyPct?: string | null;
  mintAuthorityRenounced?: boolean | null;
  freezeAuthorityRenounced?: boolean | null;
  hasSocialLink?: boolean | null;
  safety: SafetyResult;
  detectedAt: string;
  icon: string | null;
  market: TokenMarket | null;
  /** Tracked-wallet activity on this token from GMGN (see lib/gmgn/track.ts).
   * Null when GMGN isn't configured or no tracked wallet has touched it. */
  tracked: { buys: number; sells: number; names: string[] } | null;
};

/** Polls a JSON API; keeps the last good value on a transient fetch failure. */
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

function timeAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
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
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

const HEAD_CELL =
  "px-3 py-2.5 text-left text-[0.65rem] font-semibold tracking-[0.12em] uppercase text-muted-foreground";

type AlphaResponse = {
  configured: boolean;
  data: AlphaCandidateRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  newestDetectedAt: string | null;
  source?: "robinhood";
  error?: string | null;
};

const CHECK_GLYPH_OK = (
  <Check className="text-sol-green-ink size-3 shrink-0" aria-hidden="true" />
);
const CHECK_GLYPH_SKIPPED = (
  <span className="w-3 shrink-0 text-center text-muted-foreground" aria-hidden="true">
    –
  </span>
);

/** Why a row earned its shield: the same criteria the page's own tagline
 * promises ("mint/freeze authority, creator buy %, socials"), made
 * concrete per-token instead of just a green checkmark. `reasons` on a
 * stored row is always empty (only passing candidates are inserted - see
 * app/api/alpha/route.ts), so this reads the underlying booleans instead. */
function ChecklistTooltip({ row }: { row: AlphaCandidateRow }) {
  if (row.chain === "robinhood") return <RobinhoodChecklist row={row} />;
  const creatorPct =
    row.creatorBuyPct != null ? Number(row.creatorBuyPct) : null;
  const alphaWalletDetected = row.safety?.alphaWalletDetected === true;

  return (
    <span className="group/shield relative inline-flex shrink-0">
      <button
        type="button"
        className="appearance-none border-0 bg-transparent p-0"
        aria-label="Why this token passed"
      >
        <ShieldCheck
          className="text-sol-green-ink size-3.5 shrink-0"
          aria-hidden="true"
        />
      </button>
      <div
        role="tooltip"
        className="invisible absolute top-full left-0 z-20 mt-2 w-60 rounded-lg border border-white/10 bg-popover p-3 opacity-0 shadow-lg transition-opacity duration-150 group-hover/shield:visible group-hover/shield:opacity-100 group-focus-within/shield:visible group-focus-within/shield:opacity-100"
      >
        <p className="mb-1.5 text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
          Passed the checks
        </p>
        <ul className="space-y-1 text-xs text-popover-foreground">
          <li className="flex items-center gap-1.5">
            {row.mintAuthorityRenounced ? CHECK_GLYPH_OK : CHECK_GLYPH_SKIPPED}
            Mint authority renounced
          </li>
          <li className="flex items-center gap-1.5">
            {row.freezeAuthorityRenounced ? CHECK_GLYPH_OK : CHECK_GLYPH_SKIPPED}
            Freeze authority renounced
          </li>
          <li className="flex items-center gap-1.5">
            {row.hasSocialLink ? CHECK_GLYPH_OK : CHECK_GLYPH_SKIPPED}
            Has a social link
          </li>
          {creatorPct != null && (
            <li className="flex items-center gap-1.5">
              {CHECK_GLYPH_OK}
              Creator bought {creatorPct.toFixed(1)}%
            </li>
          )}
          {alphaWalletDetected && (
            <li className="flex items-center gap-1.5">
              {CHECK_GLYPH_OK}
              Tracked wallet already in
            </li>
          )}
        </ul>
      </div>
    </span>
  );
}

/** Robinhood/EVM version of the checklist: the facts the house's
 * Robinhood safety policy actually checked (owner, blacklist, creator
 * holding, socials) - never the Solana mint/freeze concepts. */
function RobinhoodChecklist({ row }: { row: AlphaCandidateRow }) {
  const s = row.safety;
  return (
    <span className="group/shield relative inline-flex shrink-0">
      <button type="button" className="appearance-none border-0 bg-transparent p-0" aria-label="Why this token passed">
        <ShieldCheck className="text-sol-green-ink size-3.5 shrink-0" aria-hidden="true" />
      </button>
      <div
        role="tooltip"
        className="invisible absolute top-full left-0 z-20 mt-2 w-60 rounded-lg border border-white/10 bg-popover p-3 opacity-0 shadow-lg transition-opacity duration-150 group-hover/shield:visible group-hover/shield:opacity-100 group-focus-within/shield:visible group-focus-within/shield:opacity-100"
      >
        <p className="mb-1.5 text-[0.65rem] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
          Passed the house checks
        </p>
        <ul className="space-y-1 text-xs text-popover-foreground">
          <li className="flex items-center gap-1.5">
            {s?.ownerRenounced ? CHECK_GLYPH_OK : CHECK_GLYPH_SKIPPED}
            Contract ownership renounced
          </li>
          <li className="flex items-center gap-1.5">
            {s?.isBlacklistCapable === false ? CHECK_GLYPH_OK : CHECK_GLYPH_SKIPPED}
            No blacklist capability
          </li>
          <li className="flex items-center gap-1.5">
            {s?.hasSocialLink ? CHECK_GLYPH_OK : CHECK_GLYPH_SKIPPED}
            Has a social link
          </li>
          {s?.creatorHoldPct != null && (
            <li className="flex items-center gap-1.5">
              {CHECK_GLYPH_OK}
              Creator holds {s.creatorHoldPct.toFixed(1)}%
            </li>
          )}
          {s?.alphaWalletDetected === true && (
            <li className="flex items-center gap-1.5">
              {CHECK_GLYPH_OK}
              Tracked wallet already in
            </li>
          )}
        </ul>
      </div>
    </span>
  );
}

export function AlphaTable() {
  const [page, setPage] = useState(1);
  // Active Robinhood Chain feed by default; the Solana archive on request.
  const [source, setSource] = useState<"robinhood" | "solana">("robinhood");
  const response = usePolledJson<AlphaResponse>(
    source === "robinhood" ? "/api/alpha" : `/api/alpha?source=solana&page=${page}`,
    25_000,
  );
  const robinhood = source === "robinhood";
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
      <div className="rounded-2xl bg-card p-5 text-sm text-muted-foreground">
        Connect DATABASE_URL to see live alpha candidates.
      </div>
    );
  }

  const rows = response?.data ?? [];
  const total = response?.total ?? 0;
  const totalPages = response?.totalPages ?? 1;
  // The server clamps an out-of-range page (the feed grows underneath the
  // client), so trust its echoed page over local state for the label.
  const currentPage = response?.page ?? page;
  const pageSize = response?.pageSize ?? 20;
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, total);

  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Alpha source">
              {(["robinhood", "solana"] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  role="tab"
                  aria-selected={source === src}
                  onClick={() => {
                    setSource(src);
                    setPage(1);
                  }}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.15em] uppercase transition-colors",
                    source === src ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {src === "robinhood" ? "Robinhood Chain · live" : "Solana · historical"}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {robinhood
                ? "Fresh Robinhood Chain launches that passed the house's own entry checks: contract ownership, blacklist capability, creator holding, socials."
                : "Archive from the retired Solana engine, newest first, one row per ticker. Every row passed the Raven\u2019s Solana entry criteria at the time: mint/freeze authority, creator buy %, socials."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {response && total > 0 && (
            <div className="text-right">
              <p className="text-xs font-medium tabular-nums">
                {total.toLocaleString()} tracked
              </p>
              {response.newestDetectedAt && (
                <p className="text-[0.65rem] text-muted-foreground">
                  newest {timeAgo(response.newestDetectedAt, now)}
                </p>
              )}
            </div>
          )}
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
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          {!response
            ? "Loading…"
            : robinhood && response.error
              ? `No passing launches yet (${/429|provider_error/.test(response.error) ? "GMGN is rate-limiting right now" : response.error}).`
              : "No candidates yet; the engine is still watching."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="border-y border-white/5">
              <tr>
                <th className={HEAD_CELL}>Token</th>
                <th className={cn(HEAD_CELL, "text-right")}>Market cap</th>
                <th className={cn(HEAD_CELL, "text-right")}>Change</th>
                <th className={cn(HEAD_CELL, "text-right")}>{robinhood ? "Creator holds" : "Dev buy"}</th>
                <th className={HEAD_CELL}>Who&apos;s in</th>
                <th className={cn(HEAD_CELL, "text-right")}>Seen</th>
                <th className={cn(HEAD_CELL, "text-right")}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const creatorPct =
                  row.chain === "robinhood"
                    ? (row.safety?.creatorHoldPct ?? null)
                    : row.creatorBuyPct != null
                      ? Number(row.creatorBuyPct)
                      : null;
                const social = row.safety?.metadata;
                const socialLink =
                  social?.twitter || social?.website || social?.telegram;
                const mc = row.market?.marketCapUsd ?? null;
                const change = row.market?.changePct ?? null;
                const changeWindow = row.market?.changeWindow ?? null;

                return (
                  <tr
                    key={row.id}
                    className="border-b border-white/5 transition-colors last:border-b-0 hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <TokenIcon src={row.icon} symbol={row.symbol} />
                        <ChecklistTooltip row={row} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            ${row.symbol ?? "?"}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {row.name}
                            <span className="ml-2 font-mono">
                              {shortMint(row.token)}
                            </span>
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {mc != null ? (
                        formatUsd(mc)
                      ) : (
                        <span
                          className="text-xs text-muted-foreground"
                          title="No DEX pair yet; still on its bonding curve"
                        >
                          not priced yet
                        </span>
                      )}
                    </td>

                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums",
                        change == null && "text-muted-foreground",
                        change != null && change > 0 && "text-sol-green-ink",
                        change != null && change < 0 && "text-destructive"
                      )}
                    >
                      {change != null ? (
                        <>
                          {change > 0 ? "+" : ""}
                          {change.toFixed(1)}%
                          {changeWindow && (
                            <span className="ml-1 text-[0.65rem] text-muted-foreground">
                              {changeWindow}
                            </span>
                          )}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {creatorPct != null ? `${creatorPct.toFixed(1)}%` : "-"}
                    </td>

                    <td className="px-3 py-2.5">
                      {row.tracked ? (
                        <span
                          className="flex items-center gap-1.5 text-xs"
                          title={row.tracked.names.join(", ")}
                        >
                          {row.tracked.buys > 0 && (
                            <span className="text-sol-green-ink whitespace-nowrap">
                              {row.tracked.buys} buying
                            </span>
                          )}
                          {row.tracked.sells > 0 && (
                            <span className="text-destructive whitespace-nowrap">
                              {row.tracked.sells} selling
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-right text-xs whitespace-nowrap text-muted-foreground">
                      {timeAgo(row.detectedAt, now)}
                    </td>

                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => copyMint(row.token)}
                          aria-label={`Copy ${row.symbol ?? "token"} contract address`}
                          title="Copy CA"
                          className="text-muted-foreground transition-colors hover:text-accent"
                        >
                          {copiedMint === row.token ? (
                            <Check className="text-sol-green-ink size-4" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                        </button>
                        <a
                          href={socialLink || (row.chain === "robinhood" ? explorerUrl("address", row.token) : `https://pump.fun/coin/${row.token}`)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${row.symbol ?? "token"}`}
                          className="text-muted-foreground transition-colors hover:text-accent"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {rangeStart}&ndash;{rangeEnd} of {total} tickers
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
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
              aria-label="Next page"
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
