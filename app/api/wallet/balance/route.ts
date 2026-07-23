import { type NextRequest, NextResponse } from "next/server";

import { getAddressBalance } from "@/lib/solana/wallet";

// Balance must be fresh on every request — never cache this route.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const addr = request.nextUrl.searchParams.get("address");
  if (!addr) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }
  const snapshot = await getAddressBalance(addr);
  return NextResponse.json(snapshot);
}
