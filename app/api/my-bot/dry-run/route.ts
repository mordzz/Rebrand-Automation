import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { assertNotOfficial } from "@/lib/db/official-bot";
import { userBots } from "@/lib/db/schema";
import { authErrorResponse, authenticateEvmOwner } from "@/lib/auth/privy-server";
import { discoverRobinhoodTokens } from "@/lib/gmgn/discovery-robinhood";
import { evaluateRobinhoodSafety } from "@/lib/gmgn/safety-robinhood";
import { getRobinhoodTokenSecurity } from "@/lib/gmgn/security-robinhood";
import { getEffectiveConfig } from "@/lib/sniper/effective-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Bounds the GMGN security fan-out — GMGN is rate-limited, and a config
// test only needs a representative slice of what's launching right now.
const MAX_TOKENS_EVALUATED = 10;

/**
 * One-shot config test (PR16: Robinhood Chain). Takes the freshest
 * launches from the same GMGN discovery the agent reads, fetches each
 * token's security facts, and grades them against this bot's own
 * effective config with the exact evaluateRobinhoodSafety the
 * paper-daemon uses — same fail-closed rule: no security data means
 * refused, never assumed safe. Read-only: nothing is opened, nothing is
 * written to positions/trades, the daemon and roster are untouched.
 */
export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  }

  const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
  // PR09: mutations require a verified Privy user that owns this EVM wallet.
  const auth = await authenticateEvmOwner(request, wallet);
  if (!auth.ok) return authErrorResponse(auth);

  const [bot] = await db.select().from(userBots).where(eq(userBots.walletAddress, wallet)).limit(1);
  if (!bot) {
    return NextResponse.json({ error: "No automaton deployed" }, { status: 404 });
  }
  const blocked = assertNotOfficial(bot);
  if (blocked) return blocked;

  const config = await getEffectiveConfig(bot);

  const discovered = await discoverRobinhoodTokens(undefined, 40);
  if (!discovered.ok) {
    return NextResponse.json({
      configured: discovered.reason !== "not_configured",
      tokensSeen: 0,
      tokensEvaluated: 0,
      passedCount: 0,
      results: [],
      error: `Robinhood discovery unavailable (${discovered.reason})`,
    });
  }

  const toEvaluate = [...discovered.tokens]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_TOKENS_EVALUATED);

  const results = [];
  // Sequential on purpose: GMGN's per-key rate limit.
  for (const token of toEvaluate) {
    const ageSec = Date.now() / 1000 - token.createdAt;
    const base = { token: token.tokenAddress, symbol: token.symbol ?? "?", name: token.name ?? "", ageSec };
    try {
      if (!config.entrySources.includes("gmgn")) {
        results.push({ ...base, passed: false, reasons: ["entry source \"gmgn\" is disabled in this config"] });
        continue;
      }
      const security = await getRobinhoodTokenSecurity(token.tokenAddress);
      if (!security.ok) {
        results.push({
          ...base,
          passed: false,
          reasons: [`security data unavailable (${security.reason}) — refused, not treated as safe`],
        });
        continue;
      }
      const safety = await evaluateRobinhoodSafety(token, security.security, config, ageSec);
      results.push({ ...base, passed: safety.passed, reasons: safety.reasons });
    } catch {
      results.push({ ...base, passed: false, reasons: ["could not evaluate this token, treated as a fail"] });
    }
  }

  return NextResponse.json({
    configured: true,
    tokensSeen: discovered.tokens.length,
    tokensEvaluated: results.length,
    passedCount: results.filter((r) => r.passed).length,
    results,
  });
}
