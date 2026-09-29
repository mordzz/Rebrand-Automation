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
 *                                       (REINSTATED 2026-09-29 — see below.
 *                                       A prior commit incorrectly treated
 *                                       GMGN `pons` new_creation tokens as
 *                                       pre-DEX bonding-curve candidates;
 *                                       on-chain verification proved they
 *                                       are real, live Uniswap V3 pools
 *                                       with genuine reserves from
 *                                       creation). minLiquiditySol is not
 *                                       consumed by this evaluator at all
 *                                       — not even as an on/off signal.
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
 * ── Liquidity floor — REINSTATED as an unconditional blocker ────────────
 * CORRECTED 2026-09-29. The prior commit assumed GMGN `pons` new_creation
 * candidates were Pons V2 pre-DEX bonding-curve tokens (by analogy to
 * pump.fun) and therefore removed the liquidity check entirely. That
 * assumption was WRONG and has been disproven by direct on-chain
 * verification against Robinhood Chain MAINNET (chain id 4663; the
 * earlier check had run against testnet by mistake, which returned no
 * bytecode for anything and was itself a red flag, not evidence).
 *
 * On-chain findings for the previously-sampled token
 * (0xc65a2de34f972ab545b4c74414b42aad3e9f31b9, pool
 * 0xea7217d61cbed34bd99352143d6bdc6ad9a8a2fb), and reproduced identically
 * on 2 further live-sampled `pons` new_creation candidates:
 *   - The pool is a REAL deployed contract (44KB+ bytecode) implementing
 *     the standard Uniswap V3 pool interface (`factory()`, `token0()`,
 *     `token1()`, `fee()`, `liquidity()` all callable and return sane
 *     values) — this is a genuine, live, immediately-tradeable AMM pool
 *     from the moment of token creation, not a bonding-curve stand-in.
 *   - On-chain `balanceOf` reserves at the pool address EXACTLY match
 *     GMGN's reported `base_reserve`/`quote_reserve` to displayed
 *     precision — GMGN's reserve numbers are real, not synthetic/virtual.
 *
 * CORRECTION (2026-09-29, second pass): an earlier version of this
 * comment used the pool's `factory()` result
 * (`0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`) as if it identified the
 * *launchpad*, and concluded (wrongly) that `pons` and `flap` "share a
 * factory" and therefore that GMGN's `launchpad_platform` label doesn't
 * correspond to a distinct launchpad. That reasoning was invalid:
 * `0x1f7d7550...` is the Uniswap V3 Factory itself — the DEX
 * infrastructure contract, not a launchpad. Any two launchpads built on
 * Uniswap V3 would produce pools whose `factory()` returns the same
 * address; this proves nothing about which upstream launchpad initiated
 * either launch.
 *
 * Re-investigated correctly by tracing the actual launch TRANSACTION
 * (not the pool's own `factory()` getter): for the sampled `pons` token,
 * the earliest transaction touching it was called by the creator wallet
 * directly against `0xf4fc0cd27fc8ecf17e55ee4c3f7201897df3eb75` (function
 * selector `0x686399cb`) — that single call atomically triggered the
 * token's mint, the Uniswap V3 pool creation, and several other
 * contracts' log emissions, all in one transaction. This address does
 * NOT match any of the three previously-supplied "Pons" candidate
 * factories (active/legacy direct-pool, or V2) — this repo has no
 * independent source confirming `0xf4fc0cd2...`'s branding, so its
 * identity as "Pons" specifically is UNRESOLVED against the supplied
 * candidate list, even though a real, distinct, on-chain launch
 * initiator was found. For comparison, the same tracing method on a
 * `flap`-labeled token found a DIFFERENT call target
 * (`0x8bf8eace53982a349195c452d1a22d025fae6666`) — confirming `pons` and
 * `flap` DO route through distinct on-chain contracts (correcting the
 * earlier "shared factory" claim, which was an artifact of both using
 * the same underlying DEX).
 *
 * What remains established regardless of launchpad branding: every
 * checked `pons`-labeled sample (3/3 with a pool) was a live, real
 * Uniswap V3 pool with real reserves from the moment of creation — no
 * bonding-curve intermediary was found for any of them.
 *
 * Conclusion: a real DEX pool with real (if currently small) reserves
 * exists from the moment a `pons` new_creation token is created —
 * liquidity IS a real risk property here, unlike the pump.fun/PumpPortal
 * virtual-bonding-curve-reserve case this evaluator was (incorrectly)
 * modeled after. The liquidity floor is therefore REINSTATED as an
 * unconditional blocker: every candidate refuses on this point until an
 * explicit, reviewed threshold decision is made.
 *
 * Liquidity-unit investigation — RESOLVED (2026-09-29, multi-sample
 * re-check, hardened 2026-09-29 third pass; see
 * GMGN_ROBINHOOD_FIELD_MAP.md for full data and methodology): classified
 * **VERIFIED_USD**. GMGN's `liquidity` is real and USD-denominated (this
 * part is documented), but GMGN does not publish an explicit sum
 * equation as a contractual guarantee. This investigation's own working
 * hypothesis — `base_reserve_value + quote_reserve_value` — is what
 * didn't match (off by 78–100% on every sample checked); it was never a
 * documented formula to begin with. What DID match, empirically and
 * consistently, is `2 × quote_reserve × quote_token_USD_price`
 * (quote-side value, doubled) — an empirically-observed relationship,
 * not something GMGN has published as guaranteed. This formula held
 * within 0.1–2.6% across 19 priced comparison samples (across two
 * separate live-data runs) spanning both `new_creation` (base price
 * unknown) and `completed` (base price known) stages, using the quote
 * token's own price from a separately-queried GMGN `/v1/token/info` call
 * (independent of any single pool's own reserve/value fields, but still
 * GMGN-sourced) — cross-checked against real on-chain reserve state on
 * Robinhood mainnet as well. All priced samples across both runs shared
 * the same quote token (WETH); the script now verifies this per-run via
 * a per-quote-token price cache rather than assuming it.
 *
 * This resolves the UNIT question. It does NOT by itself justify picking
 * a dollar threshold: the live `new_creation` population sampled (n=4,
 * then n=3 on a later re-run) was tiny across the board (max ≈ $9.55),
 * which resembles pump.fun's virtual-reserve non-discriminator pattern
 * but is too small a sample to prove that classification confidently.
 * The liquidity floor therefore REMAINS an unconditional blocker below —
 * verifying the unit is not the same as having enough evidence to choose
 * (or justify skipping) a threshold, which remains the user's decision
 * to make.
 *
 * This does NOT use `minLiquiditySol` (Solana, SOL-denominated) in any
 * form — not as a value, not as an on/off signal. It is not renamed or
 * reinterpreted; it remains fully Solana-only, for the Solana evaluator.
 * No new Robinhood liquidity config field (e.g. `minLiquidityUsd`) is
 * added in this correction — choosing a threshold is a separate, later,
 * explicitly-reviewed product decision, same as before.
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

  // ── Liquidity floor — MISSING/BLOCKER, unconditional. On-chain
  // verification proved GMGN `pons` new_creation tokens have a real,
  // live Uniswap V3 pool with real reserves from creation — liquidity is
  // a genuine risk property here, not an inapplicable pre-DEX concept.
  // The USD unit is now VERIFIED (see module comment) — this still
  // refuses unconditionally because no threshold has been chosen yet
  // (a separate, later decision) and the tiny available new_creation
  // sample hasn't established whether the metric even discriminates.
  // minLiquiditySol is still never read here, in any form. ──
  reasons.push(
    "liquidity policy unresolved — MISSING/BLOCKER: a real DEX pool with real reserves exists " +
      "from token creation (on-chain verified), GMGN's liquidity unit is VERIFIED_USD, but no " +
      "threshold has been chosen yet (see safety-robinhood.ts)"
  );

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
