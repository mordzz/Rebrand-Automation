import { type NextRequest, NextResponse } from "next/server";
import { formatEther, isAddress } from "viem";

import { ROBINHOOD_NATIVE_SYMBOL, ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { getNativeBalance } from "@/lib/chain/rpc";

// Balance must be fresh on every request - never cache this route.
export const dynamic = "force-dynamic";

/** Public balance lookup for a wallet address. EVM (0x) addresses are
 * read on Robinhood Chain in ETH; legacy Solana addresses are not read. */
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
  // Non-EVM (legacy Solana) addresses: the Solana runtime is retired and
  // no live Solana balance is read.
  return NextResponse.json(
    { address: addr, chain: "solana", nativeSymbol: "SOL", balanceNative: null, error: "Solana balances are no longer read" },
    { status: 200 },
  );
}
