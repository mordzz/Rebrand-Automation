import { NextResponse } from "next/server";

import { getOrCreateSniperState } from "@/lib/sniper/risk-limits";

export const dynamic = "force-dynamic";

/* sniper_state belongs to the retired SOLANA house engine
 * (scripts/sniper-daemon.ts, removed in PR09A). The active paper daemon
 * trades per-user Robinhood bots only and never writes this row, so it is
 * reported as historical Solana state, never as a live Robinhood figure
 * (post-migration readiness). */
const HOUSE_ENGINE = "solana_retired" as const;

// The daemon heartbeated every 5s (scripts/sniper-daemon.ts) - anything
// older than this is considered stopped/crashed, not just briefly busy.
const STALE_THRESHOLD_MS = 15_000;

export async function GET() {
  const state = await getOrCreateSniperState();
  if (!state) {
    return NextResponse.json({ configured: false, status: "unknown", engine: HOUSE_ENGINE });
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

  return NextResponse.json({ configured: true, status, engine: HOUSE_ENGINE, state });
}
