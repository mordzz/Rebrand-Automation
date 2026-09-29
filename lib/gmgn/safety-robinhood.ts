import type { SniperConfig } from "@/lib/sniper/config";
import type { RobinhoodDiscoveredToken } from "./discovery-robinhood";
import type { RobinhoodSecurityFacts } from "./security-robinhood";
import { checkAlphaWalletBuyRobinhood } from "@/lib/chain/alpha-wallets-robinhood";

/**
 * Robinhood/EVM safety evaluator — PR06 (data foundation) / PR06.5
 * (explicit Robinhood-specific policy).
 *
 * NOT wired into any daemon yet (that's PR07). Given a discovered token,
 * its security facts, and the operator's config, decides pass/refuse.
 *
 * PR06.5 core rule: the legacy Solana config fields
 * (requireMintAuthorityRenounced, requireFreezeAuthorityRenounced,
 * maxCreatorBuyPct, minLiquiditySol) are NOT reinterpreted, renamed, or
 * consulted here at all — they remain Solana-only, for the Solana/GMGN
 * evaluator (lib/gmgn/safety.ts), untouched. This evaluator consumes
 * separate, explicitly-named Robinhood/EVM fields
 * (requireOwnerRenounced, requireNoBlacklistCapability,
 * maxCreatorHoldPct) added additively to SniperConfig/sniper_config.
 * Same overall workflow (Discovery → Safety → Strategy → Risk →
 * BUY/REFUSE); different chain gets a different, explicitly-named
 * safety policy, not a shared field with silently different meaning per
 * chain.
 *
 * ══════════════════════════════════════════════════════════════════════
 * CHECK-BY-CHECK CLASSIFICATION
 * ══════════════════════════════════════════════════════════════════════
 *   Social link required            → KEEP EXACTLY (same intent, GMGN data)
 *   Blocked name/symbol keyword      → KEEP EXACTLY
 *   Min/max token age                → KEEP EXACTLY (source changes: GMGN
 *                                       created_timestamp instead of local
 *                                       receipt clock — thresholds unchanged)
 *   Owner renounced (requireOwnerRenounced) → NEW EVM POLICY, not a
 *                                       translation of requireMintAuthorityRenounced
 *                                       (Solana) — see below
 *   No blacklist capability (requireNoBlacklistCapability) → NEW EVM
 *                                       POLICY, not a translation of
 *                                       requireFreezeAuthorityRenounced
 *                                       (Solana) — see below
 *   Creator hold % (maxCreatorHoldPct) → NEW EVM POLICY measuring CURRENT
 *                                       holding concentration, not a
 *                                       translation of maxCreatorBuyPct
 *                                       (Solana, initial allocation) —
 *                                       see below. Configuration blocker
 *                                       until explicitly set.
 *   Token-2022 extension refusal     → NOT PORTED (wrong concept for EVM;
 *                                       existing GMGN honeypot/tax floors
 *                                       reused instead, see below)
 *   Alpha wallet buy required        → MAP TO EVM EQUIVALENT (ERC-20
 *                                       balanceOf via lib/chain/rpc.ts)
 *   Liquidity floor                  → MISSING / BLOCKER, unconditional
 *                                       (unresolved provider-unit
 *                                       discrepancy — see below). PR06.5
 *                                       does NOT add a Robinhood
 *                                       liquidity threshold field; there
 *                                       is nothing to configure yet.
 *   GMGN honeypot/tax/rug/bundler/
 *   insider/top10/wash-trading       → KEEP EXACTLY (same thresholds as
 *                                       the existing GMGN safety floors),
 *                                       unknown fails closed on every one
 *                                       of these for Robinhood specifically
 *                                       (the Solana/GMGN path's existing
 *                                       behavior, which lets unknown pass,
 *                                       is untouched)
 *
 * ── Owner renounced — NEW EVM POLICY, not a Solana translation ─────────
 * `/v1/token/security` (live-verified) returns `is_renounced`/`renounced`
 * — a real "contract ownership renounced" fact, exposed as
 * `security.ownerRenounced`. This is chosen as its own explicit Robinhood
 * policy (`requireOwnerRenounced`) specifically BECAUSE it is not the
 * same concept as Solana's mint-authority renouncement (ownership-
 * renounced ≠ "cannot mint more supply"; an EVM token can be non-mintable
 * by design with ownership still held, or mintable with ownership
 * renounced and a still-live minting path some other role controls). The
 * security endpoint also carries `renounced_mint`/`renounced_freeze_account`
 * fields, but on the one live-sampled token they read `false` while
 * `is_renounced` for that SAME token read `true` — proving they are NOT
 * synonyms and are most likely inert placeholders from GMGN's shared
 * cross-chain schema. Deliberately not consumed anywhere.
 *
 * ── No blacklist capability — NEW EVM POLICY, not a Solana translation ─
 * `is_blacklist` (contract has a blacklist function it could invoke) is
 * the EVM policy chosen to protect against issuer-controlled wallet
 * blocking — NOT a claim that this is equivalent to Solana freeze
 * authority (issuer can freeze a specific account's SPL tokens instantly
 * — a different mechanism). `requireNoBlacklistCapability` stands on its
 * own as a deliberate EVM-specific risk policy.
 *
 * ── Creator hold % — NEW EVM POLICY, not a Solana translation ──────────
 * Noah's Solana rule (`maxCreatorBuyPct`) is about the creator's INITIAL
 * buy/allocation at token creation. RE-INVESTIGATED 2026-09-29 against
 * the actual documented routes (`/v1/market/token_top_holders`,
 * `/v1/market/token_top_traders` — earlier guessed paths 404'd). On the
 * live-sampled token, the creator's row had `amount_percentage: 4.4e-7`
 * (current holding) but every buy/cost field (`cost`, `buy_amount_cur`,
 * `buy_volume_cur`, `buy_tx_count_cur`, `history_bought_cost`,
 * `avg_cost`) was `0`/`null`, and `start_holding_at` equaled the token's
 * own creation timestamp — no distinguishable "creator bought X at time
 * T" event exists to compute an initial-buy percentage from. No reliable
 * creator-initial-buy reconstruction was found in the inspected Robinhood
 * data sources — this does not prove no Robinhood launchpad could ever
 * expose one, only that this inspection found none.
 *
 * `maxCreatorHoldPct` is therefore an intentionally DIFFERENT policy,
 * using `creatorHoldRate` (current holding concentration) as its own
 * fact — not a substitute for the unavailable initial-buy fact, and not
 * numerically inherited from `maxCreatorBuyPct` just because both happen
 * to be percentages. Until `maxCreatorHoldPct` is explicitly configured
 * (non-null), this evaluator refuses with an explicit configuration
 * blocker — it does not silently pick a default threshold.
 *
 * ── Liquidity floor — MISSING / BLOCKER (data captured, policy not) ────
 * Robinhood's `liquidity` field's actual unit is UNRESOLVED / PROVIDER
 * SEMANTICS DISCREPANCY — two pieces of evidence conflict and neither has
 * been allowed to win by inference:
 *   1. GMGN's own documentation defines token-info/pool `liquidity` as
 *      USD-denominated (both the top-level field and `pool.liquidity`).
 *   2. The live-sampled Robinhood values (`liquidity ~0.001-0.005`) sit
 *      next to `market_cap ~5,000` in the SAME items and next to
 *      `quote_symbol: "ETH"` in `/v1/token/pool_info` — a scale and
 *      adjacency that LOOKS inconsistent with a USD contract, but
 *      `quote_symbol` identifying the pool's quote asset does not, by
 *      itself, prove `liquidity` is denominated in that asset rather
 *      than USD via some other mechanism.
 * PR06.5 does not resolve this and does not add any Robinhood liquidity
 * config field — there is nothing to compare `minLiquiditySol` against,
 * and that SOL-denominated field is not consulted here. The evaluator
 * continues to fail closed unconditionally on this point (see below).
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
  isBlacklistCapable: boolean | null;

  /** Current creator holding, 0-100 (from creatorHoldRate * 100) — NOT
   * the creator's initial buy/allocation. null when unknown or when the
   * source data (creatorHoldRate) wasn't available. */
  creatorHoldPct: number | null;
  /** Whether maxCreatorHoldPct has been explicitly configured. false
   * means the creator-hold check hit the configuration blocker rather
   * than actually evaluating creatorHoldPct against a threshold. */
  creatorHoldPolicyConfigured: boolean;

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
    | "requireOwnerRenounced"
    | "requireNoBlacklistCapability"
    | "maxCreatorHoldPct"
    | "requireSocialLink"
    | "requireAlphaWalletBuy"
    | "alphaWallets"
    | "blockedKeywords"
    | "minTokenAgeSec"
    | "maxTokenAgeSec"
    | "minLiquiditySol"
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

  // ── Owner renounced — NEW EVM POLICY. Unknown fails closed. ──
  const ownerRenounced = security?.ownerRenounced ?? null;
  if (config.requireOwnerRenounced && ownerRenounced !== true) {
    reasons.push(
      ownerRenounced === false
        ? "contract ownership not renounced"
        : "contract ownership-renounced status unknown — fails closed"
    );
  }

  // ── No blacklist capability — NEW EVM POLICY. Unknown fails closed. ──
  const isBlacklistCapable = security?.isBlacklistCapable ?? null;
  if (config.requireNoBlacklistCapability && isBlacklistCapable !== false) {
    reasons.push(
      isBlacklistCapable === true
        ? "contract has blacklist capability"
        : "blacklist-capability status unknown — fails closed"
    );
  }

  // ── Social link — KEEP EXACTLY. Unknown must not silently pass. ──
  if (config.requireSocialLink && !token.hasSocialLink) {
    reasons.push("no website/X/Telegram link");
  }

  // ── Creator hold % — NEW EVM POLICY. Configuration blocker until an
  // explicit threshold is set; never inherits maxCreatorBuyPct. ──
  const creatorHoldPct = token.creatorHoldRate != null ? token.creatorHoldRate * 100 : null;
  const creatorHoldPolicyConfigured = config.maxCreatorHoldPct != null;
  if (!creatorHoldPolicyConfigured) {
    reasons.push(
      "maxCreatorHoldPct not configured — configuration blocker: an explicit product decision " +
        "is required before the Robinhood creator-hold check can run (see safety-robinhood.ts)"
    );
  } else if (creatorHoldPct == null) {
    reasons.push("creator holding percentage unknown — fails closed");
  } else if (creatorHoldPct > config.maxCreatorHoldPct!) {
    reasons.push(
      `creator holds ${creatorHoldPct.toFixed(1)}% of supply (limit ${config.maxCreatorHoldPct}%)`
    );
  }

  // ── Existing GMGN risk floors — KEEP EXACTLY (same thresholds as the
  // Solana path), applied to Robinhood's equivalent fields. Prefer
  // security-endpoint facts when available (live-verified as real
  // booleans there); fall back to the trenches token's own fields.
  //
  // Unknown (null) now fails closed on every one of these — an
  // undetermined safety-critical fact must refuse, not silently pass.
  // This is a change from the Solana/GMGN path's existing behavior
  // (which lets null through) — deliberately NOT ported back there;
  // this file only governs the Robinhood evaluator. ──
  const isHoneypot = security?.isHoneypot ?? token.isHoneypot;
  if (isHoneypot !== false) {
    reasons.push(
      isHoneypot === true ? "flagged as a honeypot" : "honeypot status unknown — fails closed"
    );
  }

  const sellTaxPct = security?.sellTaxPct ?? token.sellTaxPct;
  if (sellTaxPct == null) {
    reasons.push("sell tax unknown — fails closed");
  } else if (sellTaxPct > MAX_SELL_TAX_PCT) {
    reasons.push(`sell tax ${sellTaxPct}% over ${MAX_SELL_TAX_PCT}% limit`);
  }

  const buyTaxPct = security?.buyTaxPct ?? token.buyTaxPct;
  if (buyTaxPct == null) {
    reasons.push("buy tax unknown — fails closed");
  } else if (buyTaxPct > MAX_BUY_TAX_PCT) {
    reasons.push(`buy tax ${buyTaxPct}% over ${MAX_BUY_TAX_PCT}% limit`);
  }

  if (token.rugRatio == null) {
    reasons.push("deployer rug history unknown — fails closed");
  } else if (token.rugRatio > MAX_RUG_RATIO) {
    reasons.push(`deployer rug history ${(token.rugRatio * 100).toFixed(0)}% over ${MAX_RUG_RATIO * 100}% limit`);
  }

  if (token.bundlerRate == null) {
    reasons.push("bundler concentration unknown — fails closed");
  } else if (token.bundlerRate > MAX_BUNDLER_RATE) {
    reasons.push(`bundled launch: ${(token.bundlerRate * 100).toFixed(0)}% bundler-held`);
  }

  if (token.insiderHoldRate == null) {
    reasons.push("insider concentration unknown — fails closed");
  } else if (token.insiderHoldRate > MAX_INSIDER_HOLD_RATE) {
    reasons.push(`insider concentration ${(token.insiderHoldRate * 100).toFixed(0)}%`);
  }

  const top10HolderRate = security?.top10HolderRate ?? token.top10HolderRate;
  if (top10HolderRate == null) {
    reasons.push("top-10 holder concentration unknown — fails closed");
  } else if (top10HolderRate > MAX_TOP10_HOLDER_RATE) {
    reasons.push(`top-10 hold ${(top10HolderRate * 100).toFixed(0)}% over ${MAX_TOP10_HOLDER_RATE * 100}% limit`);
  }

  if (token.isWashTrading !== false) {
    reasons.push(
      token.isWashTrading === true ? "wash trading detected" : "wash-trading status unknown — fails closed"
    );
  }

  // ── Liquidity floor — MISSING/BLOCKER, unconditional. PR06.5 adds no
  // Robinhood liquidity config field; minLiquiditySol (Solana, SOL-
  // denominated) is never consulted here. See module comment. ──
  if (config.minLiquiditySol > 0) {
    reasons.push(
      "liquidity policy unresolved — MISSING/BLOCKER: Robinhood liquidity's actual unit is an " +
        "unresolved provider-semantics discrepancy (GMGN docs say USD; live values look ETH-like), " +
        "and no Robinhood-specific liquidity config field exists yet (see safety-robinhood.ts)"
    );
  }

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
    ownerRenounced,
    isBlacklistCapable,
    creatorHoldPct,
    creatorHoldPolicyConfigured,
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
