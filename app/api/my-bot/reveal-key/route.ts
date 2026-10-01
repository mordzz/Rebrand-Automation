import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Agent private-key export - RETIRED (PR09A).
 *
 * The only implemented reveal path was for legacy Solana agent wallets,
 * proven by an ed25519 challenge signed with the owner's Solana wallet.
 * The Solana runtime (and its signature verification) is retired with the
 * Robinhood migration, and exporting an autonomous Robinhood/EVM agent key
 * is deliberately NOT implemented: that would need its own audited
 * owner-proof design. Both methods fail closed.
 */
function retired() {
  return NextResponse.json(
    { error: "Agent key export is unavailable: the Solana reveal flow is retired and EVM key export is not supported." },
    { status: 410 }
  );
}

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}
