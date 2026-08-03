import { NextResponse } from "next/server";

import {
  createPendingPerpspadToken,
  getPerpspadTokens,
} from "@/lib/perps/tokens";
import { getMarketBySymbol } from "@/lib/perps/markets";

export const dynamic = "force-dynamic";

function isPlausibleSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

const MAX_LEVERAGE = 20;

/** Every launched Perpspad token, newest first. `configured: false` when
 * DATABASE_URL is unset, same convention as every other list route in
 * this app. */
export async function GET() {
  const data = await getPerpspadTokens();
  return NextResponse.json({ configured: true, data });
}

/**
 * Phase 0 only: records a creator's launch intent as a `status: "pending"`
 * row — no chain interaction happens here, because no on-chain program
 * exists yet (see the Perpspad plan). Once Phase 1/2 land, token creation
 * becomes a user-signed on-chain `register_token` transaction — the
 * creator spends their own money, not pooled funds, so this route's job
 * changes to "verify and ingest a transaction signature" rather than "do
 * the work" the way it does today.
 */
export async function POST(request: Request) {
  let body: {
    name?: string;
    symbol?: string;
    underlying?: string;
    direction?: string;
    targetLeverage?: number;
    creatorWallet?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim().slice(0, 60);
  const symbol = (body.symbol ?? "").trim().toUpperCase().slice(0, 20);
  const underlying = (body.underlying ?? "").trim().toUpperCase();
  const direction = body.direction;
  const targetLeverage = Number(body.targetLeverage);
  const creatorWallet = (body.creatorWallet ?? "").trim();

  if (name.length < 2) {
    return NextResponse.json({ error: "Name too short" }, { status: 400 });
  }
  if (symbol.length < 2) {
    return NextResponse.json({ error: "Symbol too short" }, { status: 400 });
  }
  if (!getMarketBySymbol(underlying)) {
    return NextResponse.json(
      { error: `Unsupported underlying market: ${underlying}` },
      { status: 400 }
    );
  }
  if (direction !== "LONG" && direction !== "SHORT") {
    return NextResponse.json(
      { error: "direction must be LONG or SHORT" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(targetLeverage) || targetLeverage < 1 || targetLeverage > MAX_LEVERAGE) {
    return NextResponse.json(
      { error: `targetLeverage must be between 1 and ${MAX_LEVERAGE}` },
      { status: 400 }
    );
  }
  if (!isPlausibleSolanaAddress(creatorWallet)) {
    return NextResponse.json({ error: "Invalid creatorWallet" }, { status: 400 });
  }

  try {
    const token = await createPendingPerpspadToken({
      name,
      symbol,
      underlying,
      direction,
      targetLeverage,
      creatorWallet,
    });
    return NextResponse.json({ configured: true, token });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create token" },
      { status: 503 }
    );
  }
}
