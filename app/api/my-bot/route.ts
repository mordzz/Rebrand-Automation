import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { userBots } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Loose base58 shape check — enough to reject garbage, not full validation.
 * NOTE (demo): the wallet is client-asserted. Before real deploys, verify
 * Privy's access token server-side instead of trusting this parameter. */
function isPlausibleSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

const CHARACTER_TYPES = new Set(["3d", "image", "gif"]);

/** The caller's deployed automaton, if any. */
export async function GET(request: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ configured: false, bot: null });

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleSolanaAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const [bot] = await db
    .select()
    .from(userBots)
    .where(eq(userBots.walletAddress, wallet))
    .limit(1);
  return NextResponse.json({ configured: true, bot: bot ?? null });
}

/** Creates or updates the caller's automaton (name + character). */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  let body: {
    wallet?: string;
    name?: string;
    characterType?: string;
    characterSrc?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const wallet = body.wallet ?? "";
  const name = (body.name ?? "").trim().slice(0, 40);
  const characterType = body.characterType ?? "";
  const characterSrc = body.characterSrc?.trim() || null;

  if (!isPlausibleSolanaAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }
  if (name.length < 2) {
    return NextResponse.json({ error: "Name too short" }, { status: 400 });
  }
  if (!CHARACTER_TYPES.has(characterType)) {
    return NextResponse.json({ error: "Invalid character type" }, { status: 400 });
  }
  if (characterType !== "3d" && !characterSrc) {
    return NextResponse.json({ error: "Character image URL required" }, { status: 400 });
  }
  if (characterSrc && !/^(https?:\/\/|\/)/.test(characterSrc)) {
    return NextResponse.json({ error: "Character URL must be http(s) or local" }, { status: 400 });
  }

  const [bot] = await db
    .insert(userBots)
    .values({ walletAddress: wallet, name, characterType, characterSrc })
    .onConflictDoUpdate({
      target: userBots.walletAddress,
      set: { name, characterType, characterSrc, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json({ configured: true, bot });
}
