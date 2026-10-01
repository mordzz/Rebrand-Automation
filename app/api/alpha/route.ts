import { desc, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { alphaCandidates } from "@/drizzle/schema";
import { getTrackedTokenIndex } from "@/lib/gmgn/track";
import { getRobinhoodAlpha } from "@/lib/alpha/robinhood-alpha";
import { getTokenMarkets } from "@/lib/sniper/token-market";

// New candidates land continuously while the paper daemon runs — never
// cache this route.
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
// One page is one DexScreener batch (that endpoint caps at 30 addresses),
// so a page never costs more than a single market-data round trip.
const MAX_PAGE_SIZE = 30;

/** The token's own metadata JSON (fetched from its URI at detection time)
 * carries more keys than lib/sniper/safety-checks.ts#TokenMetadata declares
 * — `image` among them, confirmed against stored rows. Read it defensively
 * rather than widening that trading-side type with a display-only field. */
function iconFrom(safety: unknown): string | null {
  const metadata = (safety as { metadata?: Record<string, unknown> } | null)?.metadata;
  const image = metadata?.image;
  return typeof image === "string" && /^https?:\/\//.test(image) ? image : null;
}

function positiveInt(raw: string | null, fallback: number, max?: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  const floored = Math.floor(n);
  return max ? Math.min(floored, max) : floored;
}

/** HISTORICAL (`?source=solana`): fresh pump.fun mints that passed the
 * house's Solana entry criteria — populated by the retired Solana engine. Chain-wide, no wallet scoping.
 *
 * One row per ticker: duplicate launches are rejected at insert time by a
 * unique index (see drizzle/schema/discovery.ts#alphaCandidates.symbolKey), so no
 * de-duplication is needed here and `total` is a true count of distinct
 * tickers.
 *
 * Rows are enriched with live market data for the requested page only; a
 * brand-new mint still on its bonding curve often has no DexScreener pair
 * yet, in which case `market` is null and the UI shows "not priced yet"
 * rather than a fabricated zero. */
export async function GET(request: NextRequest) {
  const params0 = request.nextUrl.searchParams;
  // Default: the ACTIVE Robinhood Chain feed. `?source=solana` serves the
  // historical Solana table below, unchanged.
  if (params0.get("source") !== "solana") return robinhoodAlpha();

  const db = getDb();
  if (!db) {
    return NextResponse.json({
      configured: false,
      data: [],
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 0,
      newestDetectedAt: null,
    });
  }

  const params = request.nextUrl.searchParams;
  const pageSize = positiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const requestedPage = positiveInt(params.get("page"), 1);

  // Global, not page-scoped — a header "pulse" stat should read the same
  // no matter which page of results is on screen.
  const [{ count: total, newest: newestDetectedAt }] = await db
    .select({
      count: sql<number>`count(*)::int`,
      newest: sql<string | null>`max(${alphaCandidates.detectedAt})`,
    })
    .from(alphaCandidates);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Clamp rather than 404 — the feed grows and shrinks under the client,
  // so a page that was valid a moment ago shouldn't hard-fail.
  const page = Math.min(requestedPage, totalPages);

  const rows = await db
    .select()
    .from(alphaCandidates)
    .orderBy(desc(alphaCandidates.detectedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [markets, trackedIndex] = await Promise.all([
    getTokenMarkets(rows.map((r) => r.token)),
    // Empty map when GMGN isn't configured — the column simply stays blank.
    getTrackedTokenIndex(),
  ]);

  const data = rows.map((row) => {
    const tracked = trackedIndex.get(row.token);
    return {
      ...row,
      icon: iconFrom(row.safety),
      market: markets.get(row.token) ?? null,
      /* Who is in this token, from GMGN's tracked-wallet lists. Buys and
         sells stay separate: a tracked wallet exiting is not an
         endorsement, and merging them would read as one. */
      tracked: tracked
        ? {
            buys: tracked.buys.length,
            sells: tracked.sells.length,
            names: [...tracked.buys, ...tracked.sells]
              .slice(0, 3)
              .map((t) => t.traderName),
          }
        : null,
    };
  });

  return NextResponse.json({
    configured: true,
    data,
    page,
    pageSize,
    total,
    totalPages,
    newestDetectedAt,
  });
}

/** Active Robinhood feed (lib/alpha/robinhood-alpha.ts), enriched like the
 * historical rows: DexScreener market data (address-based, chain-agnostic)
 * and GMGN tracked-wallet activity (chain=robinhood). */
async function robinhoodAlpha() {
  const { rows, error, refreshedAt } = await getRobinhoodAlpha();
  const [markets, trackedIndex] = await Promise.all([
    getTokenMarkets(rows.map((r) => r.token)),
    getTrackedTokenIndex(),
  ]);
  const data = rows.map((row) => {
    const tracked = trackedIndex.get(row.token);
    return {
      ...row,
      id: `robinhood:${row.token}`,
      market: markets.get(row.token) ?? null,
      tracked: tracked
        ? {
            buys: tracked.buys.length,
            sells: tracked.sells.length,
            names: [...tracked.buys, ...tracked.sells].slice(0, 3).map((t) => t.traderName),
          }
        : null,
    };
  });
  return NextResponse.json({
    configured: true,
    source: "robinhood",
    data,
    page: 1,
    pageSize: data.length,
    total: data.length,
    totalPages: 1,
    newestDetectedAt: data[0]?.detectedAt ?? null,
    refreshedAt,
    error,
  });
}
