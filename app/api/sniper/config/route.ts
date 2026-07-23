import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSniperConfig, updateSniperConfig } from "@/lib/sniper/config";

export const dynamic = "force-dynamic";

/** Current live Sniper trading config — the daemon re-reads the same row every cycle. */
export async function GET() {
  if (!getDb()) {
    return NextResponse.json({ configured: false, config: null });
  }
  const config = await getSniperConfig();
  return NextResponse.json({ configured: true, config });
}

/** Applies a partial config change from the dashboard — takes effect on the
 * daemon's next cycle, no restart needed. */
export async function PATCH(request: Request) {
  if (!getDb()) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  let patch: Record<string, unknown>;
  try {
    patch = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const config = await updateSniperConfig(patch, "user");
    return NextResponse.json({ configured: true, config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 }
    );
  }
}
