import { NextResponse } from "next/server";

import { getWalletSnapshot } from "@/lib/solana/wallet";

// Balance must be fresh on every request — never cache this route.
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getWalletSnapshot();
  return NextResponse.json(snapshot);
}
