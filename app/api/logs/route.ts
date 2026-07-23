import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logs } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ configured: false, data: [] });
  }

  const rows = await db.select().from(logs).orderBy(desc(logs.createdAt)).limit(100);
  // Reverse to chronological order for the terminal's top-to-bottom scroll.
  return NextResponse.json({ configured: true, data: rows.reverse() });
}
