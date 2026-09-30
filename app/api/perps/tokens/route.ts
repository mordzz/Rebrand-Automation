import { NextResponse } from "next/server";

import { getPerpspadTokens } from "@/lib/perps/tokens";

export const dynamic = "force-dynamic";

/** Every launched Perpspad token, newest first. `configured: false` when
 * DATABASE_URL is unset, same convention as every other list route in
 * this app. */
export async function GET() {
  const data = await getPerpspadTokens();
  return NextResponse.json({ configured: true, data });
}
