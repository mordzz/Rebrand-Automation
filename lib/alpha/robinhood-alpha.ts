/**
 * Active Robinhood Chain Alpha feed — post-migration readiness.
 *
 * Same meaning as the historical Solana Alpha table: "fresh launches that
 * passed the HOUSE's own entry criteria". It is built only from what Noah
 * already has — GMGN Robinhood discovery (lib/gmgn/discovery-robinhood),
 * GMGN security facts (lib/gmgn/security-robinhood) and the exact
 * evaluateRobinhoodSafety the paper-daemon uses, applied to the house
 * config. Display only: no trade decision, no daemon change, no DB writes
 * (a public GET must not write), fail-closed on missing security data.
 *
 * GMGN is rate-limited, so evaluation is bounded and cached in memory;
 * passes accumulate across refreshes (newest first, capped). On a GMGN
 * failure the last good list is served with `error` set.
 */
import { discoverRobinhoodTokens } from "@/lib/gmgn/discovery-robinhood";
import { evaluateRobinhoodSafety, type RobinhoodSafetyCheckResult } from "@/lib/gmgn/safety-robinhood";
import { getRobinhoodTokenSecurity } from "@/lib/gmgn/security-robinhood";
import { getSniperConfig } from "@/lib/sniper/config";

export type RobinhoodAlphaRow = {
  chain: "robinhood";
  token: string;
  symbol: string | null;
  name: string | null;
  icon: string | null;
  launchpad: string | null;
  /** Age (s) when evaluated. */
  ageSec: number;
  detectedAt: string;
  safety: RobinhoodSafetyCheckResult;
};

const REFRESH_MS = 90_000;
const MAX_EVALUATED_PER_REFRESH = 8;
const MAX_ROWS = 50;

const passes = new Map<string, RobinhoodAlphaRow>();
const evaluated = new Set<string>();
let lastRefresh = 0;
let lastError: string | null = null;
let inflight: Promise<void> | null = null;

export type RobinhoodAlphaDeps = {
  discover?: typeof discoverRobinhoodTokens;
  security?: typeof getRobinhoodTokenSecurity;
  evaluate?: typeof evaluateRobinhoodSafety;
  houseConfig?: typeof getSniperConfig;
  now?: () => number;
};

async function refresh(deps: RobinhoodAlphaDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const discovered = await (deps.discover ?? discoverRobinhoodTokens)(undefined, 40);
  if (!discovered.ok) {
    lastError = discovered.reason;
    return;
  }
  const config = await (deps.houseConfig ?? getSniperConfig)();
  if (!config.entrySources.includes("gmgn")) {
    lastError = "house entry source \"gmgn\" is disabled";
    return;
  }
  const fresh = [...discovered.tokens]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((t) => !evaluated.has(t.tokenAddress))
    .slice(0, MAX_EVALUATED_PER_REFRESH);

  lastError = null;
  for (const token of fresh) {
    const security = await (deps.security ?? getRobinhoodTokenSecurity)(token.tokenAddress);
    if (!security.ok) {
      // Fail closed: unknown security is never a pass. Leave it unevaluated
      // so a later refresh can retry once GMGN answers.
      lastError = `security data unavailable (${security.reason})`;
      continue;
    }
    evaluated.add(token.tokenAddress);
    const ageSec = now() / 1000 - token.createdAt;
    const safety = await (deps.evaluate ?? evaluateRobinhoodSafety)(token, security.security, config, ageSec);
    if (!safety.passed) continue;
    passes.set(token.tokenAddress, {
      chain: "robinhood",
      token: token.tokenAddress,
      symbol: token.symbol,
      name: token.name,
      icon: token.logo,
      launchpad: token.launchpad,
      ageSec,
      detectedAt: new Date(now()).toISOString(),
      safety,
    });
  }
  if (passes.size > MAX_ROWS) {
    const keep = [...passes.values()].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)).slice(0, MAX_ROWS);
    passes.clear();
    for (const r of keep) passes.set(r.token, r);
  }
  if (evaluated.size > 5_000) evaluated.clear();
}

/** Current Robinhood Alpha rows (newest first); refreshes at most every 90s. */
export async function getRobinhoodAlpha(deps: RobinhoodAlphaDeps = {}): Promise<{
  rows: RobinhoodAlphaRow[];
  error: string | null;
  refreshedAt: string | null;
}> {
  const now = (deps.now ?? Date.now)();
  if (now - lastRefresh >= REFRESH_MS && !inflight) {
    lastRefresh = now;
    inflight = refresh(deps)
      .catch((e) => {
        lastError = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        inflight = null;
      });
  }
  if (inflight) await inflight;
  return {
    rows: [...passes.values()].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)),
    error: lastError,
    refreshedAt: lastRefresh ? new Date(lastRefresh).toISOString() : null,
  };
}

/** Test hook: reset module state. */
export function __resetRobinhoodAlphaForTests(): void {
  passes.clear();
  evaluated.clear();
  lastRefresh = 0;
  lastError = null;
  inflight = null;
}
