import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { lessons } from "@/lib/db/schema";
import { updateSniperConfig } from "@/lib/sniper/config";
import { houseAdminErrorResponse, authenticateHouseAdmin } from "@/lib/auth/privy-server";

export const dynamic = "force-dynamic";

/** Merges a lesson's suggestedConfig into the live sniper_config and marks
 * the lesson "applied" — the one-click alternative to hand-editing config
 * after reading a post-mortem in the dashboard's memory table. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // PR17: house-level mutation — verified Privy user with a linked EVM
  // wallet in HOUSE_ADMIN_WALLETS (fail closed when unset).
  const admin = await authenticateHouseAdmin(request);
  if (!admin.ok) return houseAdminErrorResponse(admin);
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const { id } = await params;
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, id));
  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }
  if (!lesson.suggestedConfig) {
    return NextResponse.json(
      { error: "This lesson has no suggested config change" },
      { status: 400 }
    );
  }

  const config = await updateSniperConfig(
    lesson.suggestedConfig as Record<string, unknown>,
    "lesson",
    lesson.id
  );

  const [updatedLesson] = await db
    .update(lessons)
    .set({ status: "applied" })
    .where(eq(lessons.id, id))
    .returning();

  return NextResponse.json({ lesson: updatedLesson, config });
}
