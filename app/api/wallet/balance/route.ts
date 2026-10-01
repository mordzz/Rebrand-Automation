import { type NextRequest, NextResponse } from "next/server";
import { formatEther, isAddress } from "viem";

import { ROBINHOOD_NATIVE_SYMBOL, ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { getNativeBalance } from "@/lib/chain/rpc";
import { getAddressBalance } from "@/lib/solana/wallet";

// Balance must be fresh on every request — never cache this route.
export const dynamic = "force-dynamic";

/** Public balance lookup for a wallet address. EVM (0x) addresses are
 * read on Robinhood Chain in ETH (PR14); legacy Solana addresses keep
 * the historical Solana reader. */
export async function GET(request: NextRequest) {
  const addr = request.nextUrl.searchParams.get("address");
  if (!addr) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }
  if (isAddress(addr)) {
    try {
      const wei = await getNativeBalance(addr);
      return NextResponse.json({
        address: addr,
        chain: "robinhood",
        network: ROBINHOOD_NETWORK,
        nativeSymbol: ROBINHOOD_NATIVE_SYMBOL,
        balanceNative: formatEther(wei),
        error: null,
      });
    } catch (error) {
      return NextResponse.json({
        address: addr,
        chain: "robinhood",
        network: ROBINHOOD_NETWORK,
        nativeSymbol: ROBINHOOD_NATIVE_SYMBOL,
        balanceNative: null,
        error: error instanceof Error ? error.message : "RPC unavailable",
      });
    }
  }
  const snapshot = await getAddressBalance(addr);
  return NextResponse.json({ ...snapshot, chain: "solana", nativeSymbol: "SOL" });
}
