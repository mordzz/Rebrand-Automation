import { NextResponse } from "next/server";

import { getOrCreateSniperState } from "@/lib/sniper/risk-limits";

export const dynamic = "force-dynamic";

// The daemon heartbeats every 5s (see scripts/sniper-daemon.ts) — anything
// older than this is considered stopped/crashed, not just briefly busy.
const STALE_THRESHOLD_MS = 15_000;

export async function GET() {
  const state = await getOrCreateSniperState();
  if (!state) {
    return NextResponse.json({ configured: false, status: "unknown" });
  }

  const heartbeatAgeMs = state.lastHeartbeatAt
    ? Date.now() - state.lastHeartbeatAt.getTime()
    : null;
  const status =
    heartbeatAgeMs == null
      ? "never_started"
      : heartbeatAgeMs < STALE_THRESHOLD_MS
        ? "online"
        : "stale";

  return NextResponse.json({ configured: true, status, state });
}
