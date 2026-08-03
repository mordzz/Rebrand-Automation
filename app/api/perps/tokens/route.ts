import { NextResponse } from "next/server";

import { fetchOnChainPerpToken } from "@/lib/perps/onchain";
import { getPerpspadTokens, ingestOnChainToken } from "@/lib/perps/tokens";

export const dynamic = "force-dynamic";

function isPlausibleSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/** Every launched Perpspad token, newest first. `configured: false` when
 * DATABASE_URL is unset, same convention as every other list route in
 * this app. */
export async function GET() {
  const data = await getPerpspadTokens();
  return NextResponse.json({ configured: true, data });
}

/**
 * Ingests a token that the creator already registered on-chain.
 *
 * The client sends only a `mint` — everything recorded comes from the
 * program's own `PerpToken` account, read back off the chain. That's the
 * whole point of this shape: the creator signs and pays for
 * `register_token` themselves, and this route's job is to mirror what
 * landed, not to take the client's word for what it says. A caller can
 * choose which mint we look at; they cannot choose what we believe about
 * it, so there is no way to fabricate a launch by posting JSON.
 *
 * Idempotent: re-posting the same mint (a retry, two tabs, a refresh
 * mid-launch) updates the existing row rather than duplicating it.
 */
export async function POST(request: Request) {
  let body: { mint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mint = (body.mint ?? "").trim();
  if (!isPlausibleSolanaAddress(mint)) {
    return NextResponse.json({ error: "Invalid mint address" }, { status: 400 });
  }

  const onChain = await fetchOnChainPerpToken(mint);
  if (!onChain) {
    // Covers "not registered", "program not deployed on this cluster",
    // and "RPC unreachable" alike — see fetchOnChainPerpToken. All three
    // mean we have no evidence, and guessing here would be the one way
    // to get a fake launch into the table.
    return NextResponse.json(
      { error: "No Perpspad token found on-chain for that mint" },
      { status: 404 }
    );
  }

  try {
    const token = await ingestOnChainToken(onChain);
    return NextResponse.json({ configured: true, token });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record token" },
      { status: 503 }
    );
  }
}
