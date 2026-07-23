import { NextResponse } from "next/server";

import { setPaused } from "@/lib/sniper/risk-limits";

export const dynamic = "force-dynamic";

/** Flips sniper_state.tradingPaused — the daemon checks this every cycle, no restart needed. */
export async function POST(request: Request) {
  let body: { paused?: boolean; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.paused !== "boolean") {
    return NextResponse.json(
      { error: "paused (boolean) is required" },
      { status: 400 }
    );
  }

  await setPaused(body.paused, body.reason);
  return NextResponse.json({ ok: true });
}
