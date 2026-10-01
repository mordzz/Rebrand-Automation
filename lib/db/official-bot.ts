import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { userBots, type UserBot } from "@/drizzle/schema";

/** The single public "Noah" agent shown on /dashboard - see
 * drizzle/schema/bots.ts#userBots.isOfficial. `null` when unconfigured or not
 * yet provisioned (see scripts/provision-official-bot.ts). */
export async function getOfficialBot(): Promise<UserBot | null> {
  const db = getDb();
  if (!db) return null;
  const [bot] = await db
    .select()
    .from(userBots)
    .where(eq(userBots.isOfficial, true))
    .limit(1);
  return bot ?? null;
}

/** Every mutating /api/my-bot/* route calls this right after loading its
 * bot row. Noah's wallet address is printed on a public page, so the
 * client-asserted-wallet trust the rest of that surface relies on no
 * longer holds - refuse outright rather than trust the caller. */
export function assertNotOfficial(bot: UserBot | null): NextResponse | null {
  if (!bot?.isOfficial) return null;
  return NextResponse.json(
    { error: "The official Noah agent cannot be modified." },
    { status: 403 }
  );
}
