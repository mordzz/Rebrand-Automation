import { gmgnRequest } from "./client";
import { ROBINHOOD_NETWORK, type RobinhoodNetwork } from "@/lib/chain/config";

/**
 * GMGN Robinhood-Chain discovery adapter (PR05).
 *
 * ══════════════════════════════════════════════════════════════════════
 * VERIFICATION STATUS — read before trusting any field mapping below.
 * ══════════════════════════════════════════════════════════════════════
 * GMGN_API_KEY is unset in this environment, so no live authenticated
 * call to `chain=robinhood` has been made — the "mandatory first step"
 * this PR was asked to complete (inspect real Robinhood payloads) could
 * NOT be finished. What follows is the best-available baseline, not a
 * verified mapping:
 *
 *   - Field *names* below (address, symbol, created_timestamp, etc.) are
 *     copied from lib/gmgn/discovery.ts, which IS verified against real
 *     production GMGN responses for `chain=sol` (see that file's
 *     comments — "verified against live rows", "seen on is_honeypot /
 *     open_source for fresh mints"). GMGN's own docs describe one shared
 *     schema/response wrapper across the chains it indexes, so these
 *     generic analytics field names (price/liquidity/risk-signal keys)
 *     are a reasonable working hypothesis for `chain=robinhood` too.
 *   - Solana-SPL-specific fields (renounced_mint, renounced_freeze_account,
 *     standard) are NOT carried into this module's type at all — they are
 *     not EVM concepts, so inventing an "always null" field for them would
 *     misrepresent absence-of-concept as absence-of-data. Their EVM
 *     equivalents (owner-renounced, blacklist capability, etc.) are PR06's
 *     job, not this one's.
 *   - creatorAddress: GMGN's Solana response, per the same verified
 *     discovery.ts, has NO creator/deployer address field at all — this
 *     was already flagged MISSING in GMGN_ROBINHOOD_FIELD_MAP.md before
 *     this PR. Kept in this module's type (per the requested shape) but
 *     always null until a real payload proves otherwise.
 *   - Whether `chain=robinhood` returns launchpad_platform values that
 *     match the allow-list names inspected earlier this migration (see
 *     GMGN_ROBINHOOD_FIELD_MAP.md — trench, pons, noxa, dyorswap, …) is
 *     UNVERIFIED. The allow-list mechanism below is structured to be
 *     supplied explicitly rather than hardcoded pervasively, precisely
 *     because this hasn't been confirmed against a real payload.
 *
 * Once a real GMGN_API_KEY is available, run `npm run inspect:gmgn-robinhood`
 * (scripts/inspect-gmgn-robinhood.ts) and update this file's normalize()
 * function and GMGN_ROBINHOOD_FIELD_MAP.md from the actual response before
 * this adapter is wired into any live discovery loop.
 */

/**
 * Curated v1 launchpad allow-list. NOT GMGN's full Robinhood default
 * allow-list (~26 platforms) — per the migration plan, enabling every
 * GMGN-supported Robinhood launchpad would apply pump.fun-shaped safety
 * assumptions to launch mechanics that were never evaluated against.
 *
 * `trench` and `pons` are carried over from GMGN_ROBINHOOD_FIELD_MAP.md's
 * earlier audit as the closest conceptual analogs to pump.fun's
 * permissionless bonding-curve model — but that judgment was made from
 * documentation, not a real payload, and is a PRODUCT decision pending
 * explicit sign-off, not a technical one this PR is authorized to finalize.
 * Structured as a plain override-able array specifically so it isn't
 * silently treated as final.
 */
export const ROBINHOOD_LAUNCHPAD_ALLOWLIST: readonly string[] = ["trench", "pons"];

export type RobinhoodDiscoveredToken = {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  launchpad: string | null;
  /** Always "new_creation" in v1 — near_completion/completed are out of
   * scope per the plan (new product behavior, not this migration). */
  stage: "new_creation";
  /** Unix seconds. */
  createdAt: number;

  /** Always null for now — see the module-level verification-status
   * comment. Not the same as "verified absent"; it is "not yet checked". */
  creatorAddress: string | null;

  hasSocialLink: boolean;
  twitter: string | null;
  telegram: string | null;
  website: string | null;

  isHoneypot: boolean | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  rugRatio: number | null;
  top10HolderRate: number | null;
  bundlerRate: number | null;
  insiderHoldRate: number | null;
  creatorHoldRate: number | null;
  creatorLaunchCount: number | null;
  isWashTrading: boolean | null;
  imageDup: number | null;

  marketCapUsd: number | null;
  totalSupply: number | null;
  liquidity: number | null;
  holderCount: number | null;
  progress: number | null;

  smartMoneyCount: number | null;
  kolCount: number | null;

  chain: "robinhood";
  network: RobinhoodNetwork;

  /** Unnormalized source payload, for logging/debugging — never spread
   * into sniper/safety/risk code, per the plan's "do not leak
   * provider-specific shape" rule. */
  raw: Record<string, unknown>;
};

export type RobinhoodDiscoveryResult =
  | { ok: true; tokens: RobinhoodDiscoveredToken[] }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "provider_error"; detail: string }
  | { ok: false; reason: "malformed_payload"; detail: string };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return null;
}

function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Normalizes one raw GMGN trenches item into the chain-neutral shape
 * above. Returns null for anything missing a usable token address or
 * creation timestamp — same "skip rather than half-populate" contract
 * lib/gmgn/discovery.ts already uses for Solana, extended here to also
 * reject an address that isn't EVM-shaped (a `0x...` value is a hard
 * requirement for this chain, unlike Solana's base58 addresses).
 */
export function normalizeRobinhoodToken(
  raw: Record<string, unknown>,
  network: RobinhoodNetwork = ROBINHOOD_NETWORK
): RobinhoodDiscoveredToken | null {
  if (typeof raw !== "object" || raw === null) return null;

  const tokenAddress = str(raw.address);
  const createdAt = num(raw.created_timestamp);
  if (!tokenAddress || !isEvmAddress(tokenAddress) || createdAt == null) return null;

  const launchpad = str(raw.launchpad_platform) ?? str(raw.launchpad);

  const twitter = str(raw.twitter);
  const telegram = str(raw.telegram);
  const website = str(raw.website);

  return {
    tokenAddress,
    symbol: str(raw.symbol),
    name: str(raw.name),
    logo: str(raw.logo),
    launchpad,
    stage: "new_creation",
    createdAt,
    creatorAddress: null, // see module-level verification-status comment

    hasSocialLink: bool(raw.has_at_least_one_social) ?? Boolean(twitter || telegram || website),
    twitter,
    telegram,
    website,

    isHoneypot: bool(raw.is_honeypot),
    buyTaxPct: num(raw.buy_tax),
    sellTaxPct: num(raw.sell_tax),
    rugRatio: num(raw.rug_ratio),
    top10HolderRate: num(raw.top_10_holder_rate),
    bundlerRate: num(raw.bundler_trader_amount_rate),
    insiderHoldRate: num(raw.suspected_insider_hold_rate),
    creatorHoldRate: num(raw.creator_balance_rate),
    creatorLaunchCount: num(raw.creator_created_count),
    isWashTrading: bool(raw.is_wash_trading),
    imageDup: num(raw.image_dup),

    marketCapUsd: num(raw.usd_market_cap) ?? num(raw.market_cap),
    totalSupply: num(raw.total_supply),
    liquidity: num(raw.liquidity),
    holderCount: num(raw.holder_count),
    progress: num(raw.progress),

    smartMoneyCount: num(raw.smart_degen_count),
    kolCount: num(raw.renowned_count),

    chain: "robinhood",
    network,

    raw,
  };
}

/**
 * Fetches fresh Robinhood-chain launches (new_creation only — v1 scope,
 * see the plan) through GMGN's `/v1/trenches`, filtered to
 * `launchpadAllowlist`, normalized, deduplicated by token address.
 *
 * Returns a discriminated result rather than an empty array on failure:
 * a provider outage, malformed response, or missing API key must not
 * read the same as "no new tokens this cycle" to a caller — see
 * lib/gmgn/client.ts's `gmgnRequest`.
 */
export async function discoverRobinhoodTokens(
  launchpadAllowlist: readonly string[] = ROBINHOOD_LAUNCHPAD_ALLOWLIST,
  limit = 80
): Promise<RobinhoodDiscoveryResult> {
  const body: Record<string, unknown> = {
    version: "v2",
    new_creation: {
      filters: ["offchain", "onchain"],
      launchpad_platform_v2: true,
      limit,
      launchpad_platform: [...launchpadAllowlist],
    },
  };

  const result = await gmgnRequest<Record<string, unknown[]>>(
    "/v1/trenches",
    { chain: "robinhood" },
    { method: "POST", body }
  );

  if (!result.ok) {
    if (result.kind === "not_configured") return { ok: false, reason: "not_configured" };
    if (result.kind === "malformed_payload") {
      return { ok: false, reason: "malformed_payload", detail: result.detail };
    }
    const detail =
      result.kind === "http_error"
        ? `HTTP ${result.status}`
        : result.kind === "api_error"
          ? `API error code ${result.code}${result.msg ? `: ${result.msg}` : ""}`
          : result.detail;
    return { ok: false, reason: "provider_error", detail };
  }

  const list = result.data.new_creation;
  if (!Array.isArray(list)) {
    return {
      ok: false,
      reason: "malformed_payload",
      detail: `expected data.new_creation to be an array, got ${typeof list}`,
    };
  }

  const seen = new Set<string>();
  const tokens: RobinhoodDiscoveredToken[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const token = normalizeRobinhoodToken(item as Record<string, unknown>);
    if (!token) continue;
    if (seen.has(token.tokenAddress)) continue;
    seen.add(token.tokenAddress);
    tokens.push(token);
  }

  return { ok: true, tokens: tokens.sort((a, b) => b.createdAt - a.createdAt) };
}
