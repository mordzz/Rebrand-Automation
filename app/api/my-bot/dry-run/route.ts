import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { userBots } from "@/lib/db/schema";
import { getEffectiveConfig } from "@/lib/sniper/effective-config";
import { evaluateSafety, fetchTokenSafetyData } from "@/lib/sniper/safety-checks";
import { subscribeNewTokenStream, type PumpPortalNewTokenEvent } from "@/lib/solana/pumpportal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How long to listen to the live pump.fun stream before grading anything.
const COLLECT_WINDOW_MS = 12_000;
// After the window closes, wait a bit more so tokens caught right at the
// end still get a fair shot at clearing the config's own minTokenAgeSec —
// evaluating a token before it's old enough would just show a false
// "too young" for every single one near the tail of the window.
const MAX_EXTRA_WAIT_SEC = 15;
// Bounds the RPC + IPFS fan-out below — a hot minute on pump.fun can
// produce far more mints than are worth deep-checking for one test run.
const MAX_TOKENS_EVALUATED = 20;

function isPlausibleSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/**
 * One-shot config test: listens to the real, live pump.fun mint stream for
 * a short window, then grades every token it saw against this bot's own
 * effective config using the exact same evaluateSafety used by the real
 * paper-daemon — so results are trustworthy, not a canned demo. Nothing is
 * opened, nothing is written to positions/trades; this never touches the
 * daemon or the roster, it's a fully separate, read-only evaluation.
 */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  if (!isPlausibleSolanaAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const [bot] = await db.select().from(userBots).where(eq(userBots.walletAddress, wallet)).limit(1);
  if (!bot) {
    return NextResponse.json({ error: "No automaton deployed" }, { status: 404 });
  }

  const config = await getEffectiveConfig(bot);

  const collected: { event: PumpPortalNewTokenEvent; receivedAt: number }[] = [];
  const unsubscribe = subscribeNewTokenStream(
    (event) => collected.push({ event, receivedAt: Date.now() }),
    () => {}
  );

  await new Promise((resolve) => setTimeout(resolve, COLLECT_WINDOW_MS));
  unsubscribe();

  const extraWaitMs = Math.min(Math.max(config.minTokenAgeSec, 0), MAX_EXTRA_WAIT_SEC) * 1000;
  if (extraWaitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, extraWaitMs));
  }

  const toEvaluate = collected.slice(0, MAX_TOKENS_EVALUATED);
  const results = await Promise.all(
    toEvaluate.map(async ({ event, receivedAt }) => {
      const ageSec = (Date.now() - receivedAt) / 1000;
      try {
        const tokenData = await fetchTokenSafetyData(event, config.metadataFetchTimeoutMs);
        const safety = await evaluateSafety(event, tokenData, config, ageSec);
        return {
          token: event.mint,
          symbol: event.symbol,
          name: event.name,
          ageSec,
          passed: safety.passed,
          reasons: safety.reasons,
        };
      } catch {
        return {
          token: event.mint,
          symbol: event.symbol,
          name: event.name,
          ageSec,
          passed: false,
          reasons: ["could not fetch this token's safety data, treated as a fail"],
        };
      }
    })
  );

  return NextResponse.json({
    configured: true,
    tokensSeen: collected.length,
    tokensEvaluated: results.length,
    passedCount: results.filter((r) => r.passed).length,
    results,
  });
}
