import { NextResponse } from "next/server";

import { setPaused } from "@/lib/sniper/risk-limits";
import { houseAdminErrorResponse, authenticateHouseAdmin } from "@/lib/auth/privy-server";

export const dynamic = "force-dynamic";

/** Flips sniper_state.tradingPaused — the daemon checks this every cycle, no restart needed. */
export async function POST(request: Request) {
  // PR17: house-level mutation — verified Privy user with a linked EVM
  // wallet in HOUSE_ADMIN_WALLETS (fail closed when unset).
  const admin = await authenticateHouseAdmin(request);
  if (!admin.ok) return houseAdminErrorResponse(admin);
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
