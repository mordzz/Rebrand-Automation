import { desc, eq, isNull } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { positions } from "@/lib/db/schema";

// Position state changes continuously while the sniper daemon runs —
// never cache this route.
export const dynamic = "force-dynamic";

/** `?wallet=` scopes to one deployed bot's own positions; omitted means
 * the house desk (walletAddress is null there) — never both mixed
 * together, so a user's bot never shows the house desk's numbers. */
export async function GET(request: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ configured: false, data: [] });
  }
  const wallet = request.nextUrl.searchParams.get("wallet");
  const rows = await db
    .select()
    .from(positions)
    .where(
      wallet
        ? eq(positions.walletAddress, wallet)
        : isNull(positions.walletAddress),
    )
    .orderBy(desc(positions.openedAt))
    .limit(50);
  return NextResponse.json({ configured: true, data: rows });
}
