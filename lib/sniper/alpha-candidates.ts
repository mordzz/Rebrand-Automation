import { getDb } from "@/lib/db";
import { alphaCandidates } from "@/lib/db/schema";
import type { SafetyCheckResult } from "@/lib/sniper/safety-checks";

export type RecordAlphaCandidateInput = {
  token: string;
  symbol?: string;
  name?: string;
  /** Age at the moment it was evaluated, seconds. */
  ageSec: number;
  safety: SafetyCheckResult;
};

/**
 * Baseline display filter for the public "Alpha" page — deliberately
 * separate from SniperConfig.blockedKeywords, which is an empty-by-default
 * trading-risk knob an operator opts into, not a moderation layer. Pump.fun
 * names are permissionless and unmoderated; a token passing every rug-risk
 * check can still carry a name that's simply unfit to put on a public page
 * representing the product (confirmed live during testing — a token named
 * after a slur for sexual violence passed every safety check cleanly).
 * Not exhaustive, just a floor: catches the clearly severe categories
 * (slurs, hate speech, sexual violence) rather than attempting a complete
 * profanity filter.
 */
const DISPLAY_BLOCKLIST = [
  "rape",
  "rapist",
  "nigger",
  "nigga",
  "wigger",
  // Euphemisms that carry the same slur without spelling it — caught
  // live on the public feed, so the list has to cover them too.
  "nword",
  "n-word",
  "faggot",
  "retard",
  "kike",
  "chink",
  "spic",
  "tranny",
  "molest",
  "pedo",
  "cp",
];

function isFitForDisplay(name?: string, symbol?: string): boolean {
  const haystack = `${name ?? ""} ${symbol ?? ""}`.toLowerCase();
  return !DISPLAY_BLOCKLIST.some((term) => haystack.includes(term));
}

/**
 * Normalized ticker used as the one-token-per-ticker key (see the
 * symbolKey column on lib/db/schema.ts#alphaCandidates). Deliberately
 * conservative: case, surrounding/among whitespace, a leading "$" and
 * zero-width characters are all noise a copycat can vary for free, so
 * they're stripped. Anything beyond that is left alone — folding away
 * every non-alphanumeric would start merging genuinely different tickers.
 *
 * Returns null for a missing/empty ticker so the row stays insertable:
 * Postgres permits many NULLs under a unique index, so unnamed tokens
 * never collide with one another.
 */
export function symbolKeyFor(symbol?: string | null): string | null {
  const key = (symbol ?? "")
    .replace(/[​-‍﻿]/g, "")
    .trim()
    .replace(/^\$+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return key.length > 0 ? key : null;
}

/**
 * Records a fresh mint that passed the house's own Sniper entry criteria
 * (see scripts/paper-daemon.ts, which calls this alongside its per-user
 * evaluation loop, reusing the same already-fetched token safety data).
 * Also runs the display filter above — passing the trading-safety checks
 * doesn't guarantee a name fit for a public page.
 *
 * One row per ticker: the untargeted ON CONFLICT DO NOTHING covers both
 * unique constraints, so a repeat mint (token) and a later copycat
 * re-using an existing ticker (symbolKey) are both no-ops. First mint to
 * claim a ticker keeps it, which is the closest thing to "the original"
 * this feed can actually observe — copies necessarily arrive afterwards.
 *
 * Enforcing it in the database rather than with a read-then-insert check
 * is deliberate: processPendingToken evaluates queued tokens concurrently,
 * so two copies of one ticker landing in the same tick would both pass an
 * application-level "does it exist yet" test.
 */
export async function recordAlphaCandidate(
  input: RecordAlphaCandidateInput
): Promise<void> {
  if (!isFitForDisplay(input.name, input.symbol)) return;

  const db = getDb();
  if (!db) return;

  await db
    .insert(alphaCandidates)
    .values({
      token: input.token,
      symbol: input.symbol,
      name: input.name,
      symbolKey: symbolKeyFor(input.symbol),
      ageSec: String(input.ageSec),
      creatorBuyPct:
        input.safety.creatorBuyPct != null ? String(input.safety.creatorBuyPct) : null,
      mintAuthorityRenounced: input.safety.mintAuthorityRenounced,
      freezeAuthorityRenounced: input.safety.freezeAuthorityRenounced,
      hasSocialLink: input.safety.hasSocialLink,
      safety: input.safety,
    })
    .onConflictDoNothing();
}
