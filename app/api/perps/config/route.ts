import { NextResponse } from "next/server";

import { getPerpspadPublicConfig } from "@/lib/perps/fee-split";

export const dynamic = "force-dynamic";

/** Public fee split + keeper cadence, for the UI's fee-flow diagram and
 * create-token preview. GET-only for now — no PATCH until there's a real
 * admin-auth story (see the Perpspad plan). */
export async function GET() {
  const config = await getPerpspadPublicConfig();
  return NextResponse.json({ configured: true, ...config });
}
