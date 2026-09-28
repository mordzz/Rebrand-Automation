import { gmgnRequest } from "./client";
import { ROBINHOOD_NETWORK, type RobinhoodNetwork } from "@/lib/chain/config";

/**
 * GMGN Robinhood-Chain discovery adapter (PR05).
 *
 * ══════════════════════════════════════════════════════════════════════
 * VERIFICATION STATUS — read before trusting any field mapping below.
 * ══════════════════════════════════════════════════════════════════════
 * LIVE-VERIFIED 2026-09-29 against `chain=robinhood`, `new_creation`, via
 * GMGN's public read-only demo key (60 sampled items, 3 launchpads: flap,
 * flap_pve, longxyz — see GMGN_ROBINHOOD_FIELD_MAP.md for the full
 * comparison and scripts/inspect-gmgn-robinhood.ts for how to re-run
 * this). Fields below are now real-payload-confirmed unless noted
 * otherwise:
 *
 *   - `address`, `created_timestamp`, `launchpad_platform`/`launchpad`,
 *     `symbol`, `name`, `twitter`, `telegram`, `website`,
 *     `has_at_least_one_social` (present on ~half of sampled items;
 *     absent items fall back to the twitter/telegram/website check,
 *     which still works), `total_supply`, `holder_count`,
 *     `creator_balance_rate`, `creator_created_count`, `is_wash_trading`,
 *     `image_dup` — all confirmed present with the expected shape.
 *   - `market_cap` (NOT `usd_market_cap` — that key never appeared in any
 *     sampled Robinhood item; `usd_market_cap ?? market_cap` below
 *     already falls through to the right one). Denomination is
 *     UNCONFIRMED — GMGN's field name carries no explicit currency label
 *     here (unlike the Solana adapter's `usd_market_cap`), though the
 *     observed scale (~$5,000 for freshly-launched tokens) is consistent
 *     with USD.
 *   - `liquidity` — present, but its VALUES ARE ON A COMPLETELY DIFFERENT
 *     SCALE than `market_cap` (liquidity ~0.001-0.005, market_cap
 *     ~4,900-5,200 in the same items). On Solana, `lib/gmgn/safety.ts`
 *     assumes liquidity and usd_market_cap share a unit — that assumption
 *     does NOT hold here. Liquidity looks like it may be native-ETH-
 *     denominated instead of USD. This is a PR06 blocker, not fixed here
 *     (PR05 doesn't touch safety.ts) — flagged prominently in
 *     GMGN_ROBINHOOD_FIELD_MAP.md.
 *   - `creator` — LIVE-VERIFIED present on 60/60 sampled items as a valid
 *     EVM address. Corrects the earlier (pre-verification) assumption,
 *     inherited from the Solana adapter's lack of this field, that it
 *     wouldn't exist here. Now mapped to `creatorAddress` below.
 *   - `is_honeypot`, `owner_renounced`, `open_source`, `burn_status` use
 *     GMGN's "yes"/"no"/"unknown" STRING convention on this chain, not
 *     JSON booleans (unlike `is_wash_trading`/`has_at_least_one_social`,
 *     which ARE real booleans). `bool()` below now handles both. Observed
 *     `is_honeypot` values: "unknown", "no" (no "yes" seen in this
 *     sample). `owner_renounced`/`open_source`/`burn_status` were "yes"
 *     on every sampled item (no "no" observed) — plausible EVM analogs to
 *     Solana's mint/freeze-authority checks, but mapping them into safety
 *     policy is explicitly PR06's job, not this adapter's; they are not
 *     added to RobinhoodDiscoveredToken in this PR.
 *   - No `renounced_mint`/`renounced_freeze_account`/SPL `standard`
 *     fields exist on this chain (as expected — those are Solana-SPL
 *     concepts). No dedicated nested "security" object was found either;
 *     risk signals are flat scalar fields.
 *   - Launchpad allow-list: the ONLY `launchpad_platform` values observed
 *     across 60 sampled items were `flap`, `flap_pve`, `longxyz`.
 *     `trench` and `pons` — the earlier documentation-derived guess for
 *     the eventual production allow-list — were NOT observed at all in
 *     this sample. That guess should not be treated as a starting point;
 *     the allow-list decision remains unresolved and gated behind
 *     `GMGN_ROBINHOOD_LAUNCHPADS`/an explicit caller argument regardless
 *     (see resolveLaunchpadAllowlist below) — this finding doesn't change
 *     the fail-closed mechanism, only what evidence exists to inform the
 *     eventual choice.
 *
 * This was a single ~60-item sample from one point in time via a shared
 * public demo key, not a production-scale audit — treat it as strong
 * evidence, not exhaustive proof (e.g. no "yes" is_honeypot or "no"
 * owner_renounced was observed, but that doesn't mean those values never
 * occur).
 */

/**
 * Resolves the production launchpad allow-list from an explicit caller
 * argument or the server-only `GMGN_ROBINHOOD_LAUNCHPADS` env var
 * (comma-separated). Deliberately has NO built-in default — choosing
 * which Robinhood launchpads are safe enough to snipe from is a
 * product/risk decision this adapter is not authorized to make, and a
 * hardcoded default here would silently become the de facto answer the
 * moment this code shipped. Returns null (fail closed) when neither
 * source provides a non-empty list.
 *
 * Never read from a `NEXT_PUBLIC_*` var — this is server-only
 * configuration, same posture as GMGN_API_KEY itself.
 */
export function resolveLaunchpadAllowlist(
  explicit?: readonly string[]
): string[] | null {
  if (explicit && explicit.length > 0) return [...explicit];

  const fromEnv = process.env.GMGN_ROBINHOOD_LAUNCHPADS?.trim();
  if (fromEnv) {
    const list = fromEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }

  return null;
}

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
  /** 0–100 percentage (e.g. 8.99, not 0.0899) — GMGN's raw `buy_tax`/
   * `sell_tax` are 0–1 ratios; see ratioToPct(). */
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  /** 0–1 ratio, NOT converted to percent — unlike buyTaxPct/sellTaxPct
   * above. Kept as GMGN reports it; do not assume the same 0–100 scale
   * without checking each field's own contract. */
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

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** GMGN's `buy_tax`/`sell_tax` are 0–1 ratios (0.0899 = 8.99%), live-
 * verified against the real Robinhood payload — but this module's
 * `buyTaxPct`/`sellTaxPct` fields are named (and documented) as 0–100
 * percentages, matching every other `*Pct` field here. Converting at the
 * normalization boundary keeps that contract honest instead of silently
 * handing callers a value 100x too small. */
function ratioToPct(v: unknown): number | null {
  const ratio = num(v);
  return ratio == null ? null : ratio * 100;
}

/** Handles both real booleans and GMGN's own "yes"/"no"/"unknown" string
 * convention — confirmed live on the Robinhood payload (is_honeypot,
 * owner_renounced, open_source, burn_status all use "yes"/"no"/"unknown"
 * strings, not JSON booleans, unlike the boolean has_at_least_one_social/
 * is_wash_trading fields). "unknown" (and anything else unrecognized)
 * falls through to null — never guessed as false. */
function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "yes") return true;
    if (s === "no") return false;
  }
  return null;
}

function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** Same EVM-address validation as the token address, but non-fatal: an
 * unparseable creator address shouldn't reject the whole token, it
 * should just leave creatorAddress null. */
function evmAddressOrNull(v: unknown): string | null {
  const s = str(v);
  return s && isEvmAddress(s) ? s : null;
}

/**
 * Normalizes one raw GMGN trenches item into the chain-neutral shape
 * above. Returns null for anything missing a usable token address or
 * creation timestamp — same "skip rather than half-populate" contract
 * lib/gmgn/discovery.ts already uses for Solana, extended here to also
 * reject an address that isn't EVM-shaped (a `0x...` value is a hard
 * requirement for this chain, unlike Solana's base58 addresses).
 *
 * A null return here means "structurally unusable" (malformed), not
 * "policy-excluded" — launchpad allow-list filtering happens separately,
 * in parseNewCreationPayload, on tokens that DID normalize successfully.
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
    // LIVE-VERIFIED 2026-09-29 (public GMGN demo key, chain=robinhood):
    // `creator` is present on 60/60 sampled new_creation items and is a
    // valid EVM address — see GMGN_ROBINHOOD_FIELD_MAP.md. Corrects the
    // earlier (Solana-derived) assumption that this field doesn't exist.
    creatorAddress: evmAddressOrNull(raw.creator),

    hasSocialLink: bool(raw.has_at_least_one_social) ?? Boolean(twitter || telegram || website),
    twitter,
    telegram,
    website,

    isHoneypot: bool(raw.is_honeypot),
    buyTaxPct: ratioToPct(raw.buy_tax),
    sellTaxPct: ratioToPct(raw.sell_tax),
    rugRatio: num(raw.rug_ratio),
    top10HolderRate: num(raw.top_10_holder_rate),
    bundlerRate: num(raw.bundler_trader_amount_rate),
    insiderHoldRate: num(raw.suspected_insider_hold_rate),
    creatorHoldRate: num(raw.creator_balance_rate),
    creatorLaunchCount: num(raw.creator_created_count),
    isWashTrading: bool(raw.is_wash_trading),
    imageDup: num(raw.image_dup),

    // `market_cap`, not `usd_market_cap` — the latter never appears on
    // Robinhood (live-verified). `usd_market_cap` kept as a fallback only
    // in case a future/other response shape uses it; primary key
    // reordered to match what's actually observed.
    marketCapUsd: num(raw.market_cap) ?? num(raw.usd_market_cap),
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

export type ParseOutcome =
  | { ok: true; tokens: RobinhoodDiscoveredToken[]; malformedCount: number; totalCount: number }
  | { ok: false; reason: "malformed_payload"; detail: string };

/**
 * Pure parser: turns a raw `/v1/trenches` response body into normalized,
 * allow-list-filtered, deduplicated tokens — or an explicit
 * `malformed_payload` result. Factored out from discoverRobinhoodTokens
 * specifically so it's testable without a network mock (see
 * scripts/test-gmgn-robinhood-adapter.ts).
 *
 * Required semantics (do not weaken without re-reading the PR05 review):
 *   - `new_creation` missing/not-an-array/response-not-an-object → malformed_payload
 *   - `new_creation = []` → success, zero tokens (a quiet market, not a break)
 *   - every item present but every one fails normalizeRobinhoodToken()
 *     (missing/malformed required fields) → malformed_payload, NOT an
 *     empty success — a provider schema change must not look identical
 *     to "no new tokens"
 *   - items that normalize successfully but whose launchpad isn't in
 *     `allowlist` are filtered out — this is policy, not malformation,
 *     and does NOT count toward malformedCount or trigger malformed_payload
 *   - duplicate token addresses collapse to one entry
 */
export function parseNewCreationPayload(
  data: unknown,
  allowlist: readonly string[],
  network: RobinhoodNetwork = ROBINHOOD_NETWORK
): ParseOutcome {
  if (typeof data !== "object" || data === null) {
    return {
      ok: false,
      reason: "malformed_payload",
      detail: `expected the trenches response to be an object, got ${typeof data}`,
    };
  }

  const list = (data as Record<string, unknown>).new_creation;
  if (list === undefined) {
    return { ok: false, reason: "malformed_payload", detail: "response is missing data.new_creation" };
  }
  if (!Array.isArray(list)) {
    return {
      ok: false,
      reason: "malformed_payload",
      detail: `expected data.new_creation to be an array, got ${typeof list}`,
    };
  }
  if (list.length === 0) {
    return { ok: true, tokens: [], malformedCount: 0, totalCount: 0 };
  }

  const allowSet = new Set(allowlist);
  const seen = new Set<string>();
  const tokens: RobinhoodDiscoveredToken[] = [];
  let malformedCount = 0;

  for (const item of list) {
    const token =
      typeof item === "object" && item !== null
        ? normalizeRobinhoodToken(item as Record<string, unknown>, network)
        : null;

    if (!token) {
      malformedCount++;
      continue;
    }
    if (!token.launchpad || !allowSet.has(token.launchpad)) continue; // policy exclusion, not malformed
    if (seen.has(token.tokenAddress)) continue; // duplicate, not malformed
    seen.add(token.tokenAddress);
    tokens.push(token);
  }

  // Every item present, none survived normalization at all: this is a
  // structurally broken/changed payload, not "everything got filtered by
  // policy" (which would still show malformedCount < list.length).
  if (malformedCount === list.length) {
    return {
      ok: false,
      reason: "malformed_payload",
      detail: `all ${list.length} item(s) in data.new_creation failed to normalize`,
    };
  }

  return {
    ok: true,
    tokens: tokens.sort((a, b) => b.createdAt - a.createdAt),
    malformedCount,
    totalCount: list.length,
  };
}

export type RobinhoodDiscoveryResult =
  | { ok: true; tokens: RobinhoodDiscoveredToken[] }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "launchpad_allowlist_not_configured" }
  | { ok: false; reason: "provider_error"; detail: string }
  | { ok: false; reason: "malformed_payload"; detail: string };

/**
 * Fetches fresh Robinhood-chain launches (new_creation only — v1 scope,
 * see the plan) through GMGN's `/v1/trenches`.
 *
 * Fails closed on launchpad configuration: if `launchpadAllowlist` isn't
 * supplied and `GMGN_ROBINHOOD_LAUNCHPADS` isn't set, this returns
 * `launchpad_allowlist_not_configured` rather than silently querying
 * every GMGN-supported Robinhood platform or a hardcoded guess.
 *
 * Returns a discriminated result rather than an empty array on failure:
 * a provider outage, malformed response, or missing API key must not
 * read the same as "no new tokens this cycle" to a caller — see
 * lib/gmgn/client.ts's `gmgnRequest` and parseNewCreationPayload above.
 */
export async function discoverRobinhoodTokens(
  launchpadAllowlist?: readonly string[],
  limit = 80
): Promise<RobinhoodDiscoveryResult> {
  const allowlist = resolveLaunchpadAllowlist(launchpadAllowlist);
  if (!allowlist) return { ok: false, reason: "launchpad_allowlist_not_configured" };

  const body: Record<string, unknown> = {
    version: "v2",
    new_creation: {
      filters: ["offchain", "onchain"],
      launchpad_platform_v2: true,
      limit,
      // Upstream filter — kept even though we also enforce the allow-list
      // locally below. Defense in depth: an unexpected upstream response
      // (a GMGN bug, a future API change) must not bypass the boundary
      // just because the server-side filter usually does the work.
      launchpad_platform: allowlist,
    },
  };

  const result = await gmgnRequest<Record<string, unknown>>(
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

  const outcome = parseNewCreationPayload(result.data, allowlist);
  if (!outcome.ok) return outcome;

  if (outcome.malformedCount > 0) {
    // No secrets here — just counts and the (non-secret) endpoint path.
    // Denominator is the actual raw item count, not malformedCount +
    // tokens.length — that sum silently excludes policy-filtered
    // (allow-list) and deduplicated rows, understating how many items
    // GMGN actually sent.
    console.warn(
      `[gmgn/discovery-robinhood] ${outcome.malformedCount} of ${outcome.totalCount} ` +
        `new_creation item(s) failed to normalize this cycle`
    );
  }

  return { ok: true, tokens: outcome.tokens };
}
