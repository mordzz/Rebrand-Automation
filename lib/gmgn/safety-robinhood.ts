import type { SniperConfig } from "@/lib/sniper/config";
import type { RobinhoodDiscoveredToken } from "./discovery-robinhood";
import type { RobinhoodSecurityFacts } from "./security-robinhood";
import { checkAlphaWalletBuyRobinhood } from "@/lib/chain/alpha-wallets-robinhood";

/**
 * Robinhood/EVM safety evaluator — PR06.
 *
 * NOT wired into any daemon yet (that's PR07). This is foundation:
 * given a discovered token, its security facts, and the operator's
 * config, decide pass/refuse using the same operator-configured knobs
 * pump.fun/GMGN-Solana candidates go through, adapted to what's actually
 * verifiable on Robinhood — see the check-by-check classification below
 * and PR06's report for the full mapping table.
 *
 * ══════════════════════════════════════════════════════════════════════
 * CHECK-BY-CHECK CLASSIFICATION (current Solana rule → Robinhood status)
 * ══════════════════════════════════════════════════════════════════════
 *   Social link required          → KEEP EXACTLY (same intent, GMGN data)
 *   Blocked name/symbol keyword    → KEEP EXACTLY
 *   Min/max token age              → KEEP EXACTLY (source changes: GMGN
 *                                     created_timestamp instead of local
 *                                     receipt clock — thresholds unchanged)
 *   Creator buy %                  → MISSING / BLOCKER (see below —
 *                                     ALWAYS refuses right now)
 *   Mint authority renounced       → MISSING / BLOCKER (no demonstrated
 *                                     EVM equivalent; see below)
 *   Freeze authority renounced     → MISSING / BLOCKER (no demonstrated
 *                                     EVM equivalent; see below)
 *   Token-2022 extension refusal   → NOT PORTED (wrong concept for EVM;
 *                                     existing GMGN honeypot/tax floors
 *                                     reused instead, see below)
 *   Alpha wallet buy required      → MAP TO EVM EQUIVALENT (ERC-20
 *                                     balanceOf via lib/chain/rpc.ts)
 *   Liquidity floor (minLiquiditySol) → MISSING / BLOCKER (unit mismatch,
 *                                     see below — data captured, no
 *                                     threshold enforced)
 *   GMGN honeypot/tax/rug/bundler/
 *   insider/top10/wash-trading     → KEEP EXACTLY (existing GMGN safety
 *                                     floors, same thresholds, applied to
 *                                     the equivalent Robinhood fields)
 *
 * ── Creator buy % — MISSING / BLOCKER ──────────────────────────────────
 * Noah's existing rule is about the creator's INITIAL buy/allocation at
 * token creation. `creator_balance_rate` (trenches and /v1/token/security,
 * both live-verified) is the creator's CURRENT holding ratio — a
 * different fact entirely (a creator who bought big at launch and sold
 * everything reads 0 here; one who bought nothing but later accumulated
 * reads high). Investigated for a reconstruction path: no token-holders
 * endpoint (`/v1/token/holders`, `/v1/tokens/robinhood/top_holders/:addr`)
 * or top-traders endpoint (`/v1/token/top_traders`,
 * `/v1/tokens/robinhood/top_traders/:addr`) exists — all returned HTTP
 * 404 live. No "initial buy amount" or first-trade field was found on
 * either `/v1/token/info` or `/v1/token/security`. This cannot be
 * reconstructed with sufficient confidence. Per explicit instruction,
 * this evaluator does NOT reinterpret creator_balance_rate as the
 * required fact, does NOT skip the check silently, and does NOT change
 * maxCreatorBuyPct's threshold — it fails closed: every Robinhood
 * candidate is refused with this reason until a product decision
 * resolves it. That is the correct (if inconvenient) consequence of a
 * genuinely blocked required safety fact, not a bug.
 *
 * ── Mint/freeze authority — MISSING / BLOCKER ──────────────────────────
 * `/v1/token/security` (live-verified) returns `is_renounced`/`renounced`
 * — a real "contract ownership renounced" fact, exposed here as
 * `security.ownerRenounced` — but this is NOT the same concept as
 * Solana's mint-authority renouncement (ownership-renounced ≠ "cannot
 * mint more supply"; an EVM token can be non-mintable by design with
 * ownership still held, or mintable with ownership renounced and a
 * still-live minting path some other role controls). The endpoint also
 * carries `renounced_mint`/`renounced_freeze_account` fields, but on the
 * one live-sampled token they read `false` while `is_renounced` for that
 * SAME token read `true` — proving they are NOT synonyms and are most
 * likely inert placeholders from GMGN's shared cross-chain schema. No
 * blacklist-freeze equivalent was demonstrated either — `is_blacklist`
 * (contract has a blacklist function) is the closest available fact in
 * *intent*, but freeze authority (issuer can freeze a specific account's
 * SPL tokens instantly) and "contract could implement a blacklist" are
 * different mechanisms; using it to satisfy `requireFreezeAuthorityRenounced`
 * without an explicit decision would be exactly the kind of unapproved
 * substitution this PR must avoid. Per instruction: if the corresponding
 * config knob is enabled, this evaluator does not pretend the requirement
 * is satisfied by a different fact — it refuses with an explicit blocker
 * reason instead.
 *
 * ── Liquidity floor — MISSING / BLOCKER (data captured, policy not) ────
 * `minLiquiditySol` is SOL-denominated. Live-verified: Robinhood's
 * `liquidity` field is on a wildly different numeric scale than
 * `market_cap` in the same items (~0.001-0.005 vs ~5,000) — confirmed via
 * `/v1/token/info`'s `pool` object, whose `quote_symbol: "ETH"` and whose
 * `liquidity` value matches the top-level field exactly: liquidity
 * appears to be native-asset(ETH)-denominated, not USD, and definitely
 * not comparable to a SOL-denominated threshold without an explicit unit
 * conversion decision. That conversion is not made here. `liquidity` is
 * carried on RobinhoodDiscoveredToken (data acquisition, done in PR05)
 * but no floor is enforced against it in this evaluator (policy
 * conversion, not done — pending an explicit decision on what the
 * Robinhood-side threshold should even mean).
 */

/** Existing GMGN safety floors, reused as-is — these are fixed operator-
 * independent floors on the Solana/GMGN path (lib/gmgn/safety.ts), not
 * new policy invented for this PR. Applied here to the equivalent
 * Robinhood fields, which the trenches payload already carries with the
 * same names/semantics (rug_ratio, bundler_trader_amount_rate, etc.). */
const MAX_SELL_TAX_PCT = 5;
const MAX_BUY_TAX_PCT = 5;
const MAX_RUG_RATIO = 0.1;
const MAX_BUNDLER_RATE = 0.3;
const MAX_INSIDER_HOLD_RATE = 0.3;
const MAX_TOP10_HOLDER_RATE = 0.35;

export type RobinhoodSafetyCheckResult = {
  passed: boolean;
  reasons: string[];

  /** The real EVM "contract ownership renounced" fact. Deliberately NOT
   * named mintAuthorityRenounced — see the module-level comment for why
   * those are different facts, not a chain-neutral rename of the same
   * one. */
  ownerRenounced: boolean | null;

  /** Structurally documents the blockers rather than omitting them —
   * always false right now. A future PR that resolves either blocker
   * should flip these based on an explicit, reviewed decision, not by
   * quietly deleting the field. */
  freezeEquivalentAvailable: false;
  creatorInitialBuyPctAvailable: false;

  hasSocialLink: boolean;
  metadata: {
    name?: string;
    symbol?: string;
    twitter?: string;
    telegram?: string;
    website?: string;
  };

  /** null means "gate off" (requireAlphaWalletBuy false, or an empty
   * tracked-wallet list) — never "failed". Same contract as the Solana
   * path's SafetyCheckResult.alphaWalletDetected. */
  alphaWalletDetected: boolean | null;
  matchedAlphaWallets: string[];
};

export async function evaluateRobinhoodSafety(
  token: RobinhoodDiscoveredToken,
  security: RobinhoodSecurityFacts | null,
  config: Pick<
    SniperConfig,
    | "requireMintAuthorityRenounced"
    | "requireFreezeAuthorityRenounced"
    | "requireSocialLink"
    | "requireAlphaWalletBuy"
    | "alphaWallets"
    | "maxCreatorBuyPct"
    | "blockedKeywords"
    | "minTokenAgeSec"
    | "maxTokenAgeSec"
  >,
  ageSec: number
): Promise<RobinhoodSafetyCheckResult> {
  const reasons: string[] = [];

  // ── Age — source changes (GMGN created_timestamp vs. PumpPortal local
  // receipt clock), thresholds/intent unchanged. ──
  if (ageSec < config.minTokenAgeSec) {
    reasons.push(`too young: ${ageSec.toFixed(1)}s old, minimum ${config.minTokenAgeSec}s`);
  }
  if (config.maxTokenAgeSec != null && ageSec > config.maxTokenAgeSec) {
    reasons.push(`too old by the time it was evaluated: ${ageSec.toFixed(1)}s, max ${config.maxTokenAgeSec}s`);
  }

  // ── Blocked keyword — KEEP EXACTLY ──
  const haystack = `${token.name ?? ""} ${token.symbol ?? ""}`.toLowerCase();
  for (const keyword of config.blockedKeywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle && haystack.includes(needle)) {
      reasons.push(`name/symbol contains blocked keyword "${keyword}"`);
      break;
    }
  }

  // ── Mint-authority-equivalent — MISSING/BLOCKER. If the knob is on,
  // do not pretend a different fact satisfies it. ──
  if (config.requireMintAuthorityRenounced) {
    reasons.push(
      "mint-authority-equivalent unavailable on Robinhood Chain — MISSING/BLOCKER, " +
        "requires an explicit product decision before this check can run (see safety-robinhood.ts)"
    );
  }

  // ── Freeze-authority-equivalent — MISSING/BLOCKER, same posture. ──
  if (config.requireFreezeAuthorityRenounced) {
    reasons.push(
      "freeze-authority-equivalent unavailable on Robinhood Chain — MISSING/BLOCKER, " +
        "requires an explicit product decision before this check can run (see safety-robinhood.ts)"
    );
  }

  // ── Social link — KEEP EXACTLY. Unknown must not silently pass. ──
  if (config.requireSocialLink && !token.hasSocialLink) {
    reasons.push("no website/X/Telegram link");
  }

  // ── Creator buy % — MISSING/BLOCKER, unconditional (see module
  // comment). Always refuses; never substitutes creator_balance_rate. ──
  reasons.push(
    "creator initial-buy percentage unavailable on Robinhood Chain — MISSING/BLOCKER " +
      "(creator_balance_rate is current holdings, not initial allocation; no holders/traders " +
      "endpoint exists to reconstruct it — see safety-robinhood.ts)"
  );

  // ── Existing GMGN risk floors — KEEP EXACTLY, applied to Robinhood's
  // equivalent fields. Prefer security-endpoint facts when available
  // (live-verified as real booleans there); fall back to the trenches
  // token's own fields (which use "yes"/"no"/"unknown" strings for some
  // of these, already normalized to boolean|null by discovery-robinhood.ts). ──
  const isHoneypot = security?.isHoneypot ?? token.isHoneypot;
  if (isHoneypot === true) reasons.push("flagged as a honeypot");

  const sellTaxPct = security?.sellTaxPct ?? token.sellTaxPct;
  if (sellTaxPct != null && sellTaxPct > MAX_SELL_TAX_PCT) {
    reasons.push(`sell tax ${sellTaxPct}% over ${MAX_SELL_TAX_PCT}% limit`);
  }
  const buyTaxPct = security?.buyTaxPct ?? token.buyTaxPct;
  if (buyTaxPct != null && buyTaxPct > MAX_BUY_TAX_PCT) {
    reasons.push(`buy tax ${buyTaxPct}% over ${MAX_BUY_TAX_PCT}% limit`);
  }
  if (token.rugRatio != null && token.rugRatio > MAX_RUG_RATIO) {
    reasons.push(`deployer rug history ${(token.rugRatio * 100).toFixed(0)}% over ${MAX_RUG_RATIO * 100}% limit`);
  }
  if (token.bundlerRate != null && token.bundlerRate > MAX_BUNDLER_RATE) {
    reasons.push(`bundled launch: ${(token.bundlerRate * 100).toFixed(0)}% bundler-held`);
  }
  if (token.insiderHoldRate != null && token.insiderHoldRate > MAX_INSIDER_HOLD_RATE) {
    reasons.push(`insider concentration ${(token.insiderHoldRate * 100).toFixed(0)}%`);
  }
  const top10HolderRate = security?.top10HolderRate ?? token.top10HolderRate;
  if (top10HolderRate != null && top10HolderRate > MAX_TOP10_HOLDER_RATE) {
    reasons.push(`top-10 hold ${(top10HolderRate * 100).toFixed(0)}% over ${MAX_TOP10_HOLDER_RATE * 100}% limit`);
  }
  if (token.isWashTrading === true) reasons.push("wash trading detected");

  // ── Liquidity floor — MISSING/BLOCKER (policy), data acquisition only.
  // Deliberately no threshold check here — see module comment. ──

  // ── Alpha wallet — MAP TO EVM EQUIVALENT. ──
  const alphaWalletGateActive = config.requireAlphaWalletBuy && config.alphaWallets.length > 0;
  const alphaWalletResult = alphaWalletGateActive
    ? await checkAlphaWalletBuyRobinhood(token.tokenAddress, config.alphaWallets)
    : null;
  if (alphaWalletGateActive && !alphaWalletResult?.detected) {
    reasons.push("no tracked alpha wallet holds this token");
  }

  return {
    passed: reasons.length === 0,
    reasons,
    ownerRenounced: security?.ownerRenounced ?? null,
    freezeEquivalentAvailable: false,
    creatorInitialBuyPctAvailable: false,
    hasSocialLink: token.hasSocialLink,
    metadata: {
      name: token.name ?? undefined,
      symbol: token.symbol ?? undefined,
      twitter: token.twitter ?? undefined,
      telegram: token.telegram ?? undefined,
      website: token.website ?? undefined,
    },
    alphaWalletDetected: alphaWalletResult ? alphaWalletResult.detected : null,
    matchedAlphaWallets: alphaWalletResult?.matchedWallets ?? [],
  };
}
