import { desc, eq, isNull } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { lessons, trades } from "@/lib/db/schema";
import { authenticateSignedInUser, signedInErrorResponse } from "@/lib/auth/privy-server";

/** Agent memory: lessons joined with the trades that taught them.
 *
 * `?wallet=` scopes to one deployed bot's own lessons; omitted means the
 * house desk. A lesson has no wallet of its own - it inherits one from the
 * trade that produced it, so the scope is applied on the joined trade. The
 * join therefore has to become an inner join when scoping: a lesson whose
 * trade row is missing cannot be attributed to anyone. */
export async function GET(request: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ configured: false, data: [] });
  }

  const wallet = request.nextUrl.searchParams.get("wallet");

  const columns = {
    id: lessons.id,
    cause: lessons.cause,
    lesson: lessons.lesson,
    status: lessons.status,
    suggestedConfig: lessons.suggestedConfig,
    createdAt: lessons.createdAt,
    token: trades.token,
    strategy: trades.strategy,
    nativeSymbol: trades.nativeSymbol,
    pnlNative: trades.pnlNative,
    chain: trades.chain,
    closedAt: trades.closedAt,
  };

  const rows = wallet
    ? await db
        .select(columns)
        .from(lessons)
        .innerJoin(trades, eq(lessons.tradeId, trades.id))
        .where(eq(trades.walletAddress, wallet))
        .orderBy(desc(lessons.createdAt))
        .limit(50)
    : await db
        .select(columns)
        .from(lessons)
        .leftJoin(trades, eq(lessons.tradeId, trades.id))
        .where(isNull(trades.walletAddress))
        .orderBy(desc(lessons.createdAt))
        .limit(50);

  return NextResponse.json({ configured: true, data: rows });
}

/** Mark a lesson as applied (or back to learning). */
export async function PATCH(request: Request) {
  // House dashboard action: any verified signed-in Noah operator (Privy
  // access token). Never anonymous; no separate admin role.
  const auth = await authenticateSignedInUser(request);
  if (!auth.ok) return signedInErrorResponse(auth);
  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body?.id || !["learning", "applied"].includes(body.status)) {
    return NextResponse.json(
      { error: "id and status ('learning' | 'applied') are required" },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(lessons)
    .set({ status: body.status })
    .where(eq(lessons.id, body.id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }
  return NextResponse.json({ lesson: updated });
}
