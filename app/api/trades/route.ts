import { desc, eq, isNull } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import type { ClosedTradeInput } from "@/lib/agent/analyze-loss";
import { recordClosedTrade } from "@/lib/agent/record-trade";
import { getDb } from "@/lib/db";
import { trades } from "@/lib/db/schema";
import { houseAdminErrorResponse, authenticateHouseAdmin } from "@/lib/auth/privy-server";

/** `?wallet=` scopes to one deployed bot's own trade history; omitted
 * means the house desk — see app/api/positions/route.ts for the same
 * null-means-house convention. */
export async function GET(request: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ configured: false, data: [] });
  }
  const wallet = request.nextUrl.searchParams.get("wallet");
  const rows = await db
    .select()
    .from(trades)
    .where(
      wallet ? eq(trades.walletAddress, wallet) : isNull(trades.walletAddress),
    )
    .orderBy(desc(trades.closedAt))
    .limit(50);
  return NextResponse.json({ configured: true, data: rows });
}

/**
 * Record a closed trade. Losing trades are sent to Claude for a post-mortem;
 * the resulting cause + lesson is stored as agent memory. An optional
 * `walletAddress` scopes the trade to one deployed bot instead of the
 * shared house desk.
 */
export async function POST(request: Request) {
  // PR17: house-level mutation — verified Privy user with a linked EVM
  // wallet in HOUSE_ADMIN_WALLETS (fail closed when unset).
  const admin = await authenticateHouseAdmin(request);
  if (!admin.ok) return houseAdminErrorResponse(admin);
  let body: ClosedTradeInput & { walletAddress?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.token || !body.strategy || body.pnlSol === undefined) {
    return NextResponse.json(
      { error: "token, strategy, and pnlSol are required" },
      { status: 400 },
    );
  }

  const result = await recordClosedTrade(body, body.walletAddress ?? null);
  return NextResponse.json(result);
}
