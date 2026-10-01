import { desc, eq, isNull } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logs } from "@/drizzle/schema";

export const dynamic = "force-dynamic";

/** `?wallet=` scopes the feed to one deployed bot; omitted means the house
 * desk — the same null-means-house convention as positions/trades. The
 * default must stay house-only: this powers the dashboard terminal, and an
 * unfiltered read would splice every deployed bot's activity into it. */
export async function GET(request: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ configured: false, data: [] });
  }

  const wallet = request.nextUrl.searchParams.get("wallet");
  const walletFilter = wallet
    ? eq(logs.walletAddress, wallet)
    : isNull(logs.walletAddress);

  const rows = await db
    .select()
    .from(logs)
    .where(walletFilter)
    .orderBy(desc(logs.createdAt))
    .limit(100);

  // Reverse to chronological order for the terminal's top-to-bottom scroll.
  return NextResponse.json({ configured: true, data: rows.reverse() });
}
