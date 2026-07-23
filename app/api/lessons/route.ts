import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { lessons, trades } from "@/lib/db/schema";

/** Agent memory: lessons joined with the trades that taught them. */
export async function GET() {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ configured: false, data: [] });
  }

  const rows = await db
    .select({
      id: lessons.id,
      cause: lessons.cause,
      lesson: lessons.lesson,
      status: lessons.status,
      suggestedConfig: lessons.suggestedConfig,
      createdAt: lessons.createdAt,
      token: trades.token,
      strategy: trades.strategy,
      pnlSol: trades.pnlSol,
      closedAt: trades.closedAt,
    })
    .from(lessons)
    .leftJoin(trades, eq(lessons.tradeId, trades.id))
    .orderBy(desc(lessons.createdAt))
    .limit(50);

  return NextResponse.json({ configured: true, data: rows });
}

/** Mark a lesson as applied (or back to learning). */
export async function PATCH(request: Request) {
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
