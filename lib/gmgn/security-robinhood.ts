import { gmgnRequest } from "./client";

/**
 * GMGN `/v1/token/security` for Robinhood Chain — PR06 safety-data
 * foundation.
 *
 * LIVE-VERIFIED 2026-09-29 against `chain=robinhood` (public GMGN demo
 * key, two real tokens spanning `flap` and `longxyz`). Confirmed the
 * endpoint responds for Robinhood and returns, among others:
 *
 *   is_open_source / open_source   — booleans/0-1, agree with each other
 *   is_blacklist / blacklist       — booleans/0-1, agree with each other
 *   is_honeypot / honeypot         — REAL JSON booleans here (unlike the
 *                                     trenches endpoint, where is_honeypot
 *                                     is a "yes"/"no"/"unknown" string)
 *   is_renounced / renounced       — booleans/0-1, agree with each other.
 *                                     This is the real "ownership
 *                                     renounced" EVM fact — it matches
 *                                     trenches' `owner_renounced` in
 *                                     spirit (both describe contract
 *                                     ownership, not a Solana-style mint
 *                                     authority).
 *   renounced_mint / renounced_freeze_account — PRESENT on this endpoint,
 *                                     but on the one live token sampled
 *                                     they read `false` while `is_renounced`
 *                                     for the SAME token read `true` —
 *                                     proving they are NOT synonyms for
 *                                     `is_renounced`/ownership-renounced.
 *                                     These look like inert placeholder
 *                                     fields GMGN's shared cross-chain
 *                                     schema carries for chains where
 *                                     they don't apply. Deliberately NOT
 *                                     mapped into RobinhoodSecurityFacts
 *                                     at all — capturing an always-
 *                                     disagreeing field under a
 *                                     Solana-shaped name would be exactly
 *                                     the kind of fake mapping this PR is
 *                                     required to avoid.
 *   buy_tax / sell_tax             — same 0-1 ratio contract confirmed
 *                                     live on the trenches endpoint (PR05).
 *   top_10_holder_rate, burn_ratio, burn_status, dev_token_burn_amount/
 *   ratio                          — present, same names as trenches.
 *   lock_summary.is_locked / lock_percent / lock_detail[]
 *                                  — LP-lock information, not previously
 *                                     captured anywhere in this codebase.
 *   flags[]                        — present but empty on both sampled
 *                                     tokens; shape/semantics otherwise
 *                                     unconfirmed.
 *
 * No dedicated token-holders or token-top-traders endpoint was found —
 * `/v1/token/holders`, `/v1/tokens/robinhood/top_holders/:address`,
 * `/v1/token/top_traders`, and `/v1/tokens/robinhood/top_traders/:address`
 * all returned HTTP 404. This is directly relevant to the creator-buy-%
 * investigation (see lib/gmgn/safety-robinhood.ts) — no endpoint surfaced
 * here exposes a creator's INITIAL acquisition/allocation, only current
 * state (`creator_balance_rate` / this file's nothing new either).
 */

export type RobinhoodSecurityFacts = {
  tokenAddress: string;

  /** The real "ownership renounced" EVM fact (is_renounced/renounced on
   * this endpoint). NOT a mint-authority equivalent — see the module
   * comment and lib/gmgn/safety-robinhood.ts for why those are kept
   * separate. */
  ownerRenounced: boolean | null;

  /** Contract has a blacklist function it could invoke against a
   * holder. The closest available EVM-side fact to Solana's freeze
   * authority in *intent* (issuer-side capability to block a holder from
   * transacting), but NOT a demonstrated equivalent — freeze authority
   * lets the issuer freeze a specific account's SPL tokens directly;
   * this is "the contract could implement a blacklist", a different
   * mechanism. Captured as a fact; NOT wired into any check that claims
   * to satisfy `requireFreezeAuthorityRenounced` without explicit
   * approval (see safety-robinhood.ts). */
  isBlacklistCapable: boolean | null;

  isOpenSource: boolean | null;
  /** Real JSON boolean on this endpoint (contrast: trenches' is_honeypot
   * is a "yes"/"no"/"unknown" string). */
  isHoneypot: boolean | null;

  /** 0-100 percentage, same ratioToPct contract as
   * lib/gmgn/discovery-robinhood.ts's buyTaxPct/sellTaxPct. */
  buyTaxPct: number | null;
  sellTaxPct: number | null;

  /** 0-1 ratio, range-validated via ratio01() — out-of-range normalizes
   * to null so a malformed value can't slip past the Robinhood safety
   * evaluator's threshold check. */
  top10HolderRate: number | null;
  burnRatio: number | null;
  burnStatus: string | null;

  lpLocked: boolean | null;
  /** 0-1 ratio, NOT converted to percent (matches lock_summary's own
   * "0" seen even when is_locked is true on the one sample — this field
   * looks unreliable/inconsistently populated; captured as-is, not
   * relied on for any threshold in this PR). */
  lpLockPercent: number | null;

  raw: Record<string, unknown>;
};

type RawSecurity = Record<string, unknown>;

function bool01(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  return null;
}

/** GMGN's security endpoint exposes paired fields (is_renounced/renounced,
 * is_blacklist/blacklist, is_open_source/open_source, is_honeypot/honeypot)
 * whose values are expected to agree. `a ?? b` only falls through when `a`
 * is null/undefined — if the primary key is PRESENT but malformed (e.g. an
 * unparseable string), `??` never reaches the fallback even though it
 * might parse fine. This tries each candidate in order and uses the first
 * one that actually parses, not just the first one that's non-nullish. */
function bool01FirstValid(...candidates: unknown[]): boolean | null {
  for (const candidate of candidates) {
    const parsed = bool01(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function num(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ratioToPct(v: unknown): number | null {
  const ratio = num(v);
  if (ratio == null || ratio < 0 || ratio > 1) return null;
  return ratio * 100;
}

/** Same [0,1] range guard, for a safety-critical ratio field that's kept
 * as a ratio rather than converted to a percentage — see
 * lib/gmgn/discovery-robinhood.ts's identical helper for the full
 * rationale. */
function ratio01(v: unknown): number | null {
  const ratio = num(v);
  if (ratio == null || ratio < 0 || ratio > 1) return null;
  return ratio;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function normalizeRobinhoodSecurity(
  tokenAddress: string,
  raw: RawSecurity
): RobinhoodSecurityFacts {
  const lockSummary =
    typeof raw.lock_summary === "object" && raw.lock_summary !== null
      ? (raw.lock_summary as Record<string, unknown>)
      : null;

  return {
    tokenAddress,
    ownerRenounced: bool01FirstValid(raw.is_renounced, raw.renounced),
    isBlacklistCapable: bool01FirstValid(raw.is_blacklist, raw.blacklist),
    isOpenSource: bool01FirstValid(raw.is_open_source, raw.open_source),
    isHoneypot: bool01FirstValid(raw.is_honeypot, raw.honeypot),
    buyTaxPct: ratioToPct(raw.buy_tax),
    sellTaxPct: ratioToPct(raw.sell_tax),
    top10HolderRate: ratio01(raw.top_10_holder_rate),
    burnRatio: num(raw.burn_ratio),
    burnStatus: str(raw.burn_status),
    lpLocked: lockSummary ? bool01(lockSummary.is_locked) : null,
    lpLockPercent: lockSummary ? num(lockSummary.lock_percent) : null,
    raw,
  };
}

export type SecurityFetchResult =
  | { ok: true; security: RobinhoodSecurityFacts }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "provider_error"; detail: string }
  | { ok: false; reason: "malformed_payload"; detail: string };

/**
 * Fetches and normalizes `/v1/token/security` for one Robinhood token.
 * Returns a discriminated result — same "don't collapse failure into
 * empty/unknown" posture as lib/gmgn/discovery-robinhood.ts.
 */
export async function getRobinhoodTokenSecurity(
  tokenAddress: string
): Promise<SecurityFetchResult> {
  const result = await gmgnRequest<RawSecurity>("/v1/token/security", {
    chain: "robinhood",
    address: tokenAddress,
  });

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

  if (typeof result.data !== "object" || result.data === null) {
    return {
      ok: false,
      reason: "malformed_payload",
      detail: `expected an object, got ${typeof result.data}`,
    };
  }

  return { ok: true, security: normalizeRobinhoodSecurity(tokenAddress, result.data) };
}
