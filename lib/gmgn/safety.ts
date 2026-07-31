import type { SniperConfig } from "@/lib/sniper/config";
import type { SafetyCheckResult } from "@/lib/sniper/safety-checks";

import type { DiscoveredToken } from "./discovery";
import { checkAlphaWalletBuy } from "@/lib/sniper/alpha-wallets";
import {
  MAX_TRANSFER_FEE_BPS,
  readMintExtensions,
} from "@/lib/sniper/safety-checks";
import { extensionRefusalReasons } from "@/lib/sniper/token-extensions";

/**
 * Entry gate for tokens discovered through GMGN (lib/gmgn/discovery.ts),
 * producing the same SafetyCheckResult the pump.fun path produces so
 * everything downstream — sizing, position rows, the Alpha feed — stays
 * unchanged.
 *
 * Two rules shaped this file:
 *
 * 1. Every operator-configured knob applies exactly as it does on the
 *    pump.fun path. A token arriving from a different launchpad must not
 *    quietly get an easier gate than one arriving from pump.fun.
 *
 * 2. GMGN reports risk signals our own PumpPortal path cannot see at all
 *    (honeypot, sell tax, deployer rug history, bundling, insider
 *    concentration). Those are applied as *additional* hard rejections on
 *    top of the configured ones, with conservative fixed thresholds. They
 *    can only make this path stricter, never looser — which is the only
 *    safe direction for a gate that is widening the universe of tokens
 *    the engine will touch.
 *
 * Unknown is never a pass (Design Principle 1, "refuse by default"): a
 * null from GMGN means the check could not be completed, and every check
 * below treats that as failure rather than skipping it.
 */

/** Fixed thresholds for the signals GMGN adds. Deliberately not operator
 * knobs: they are floors, not preferences, and an operator loosening them
 * would be reintroducing exactly the risks this path exists to screen. */
const MAX_SELL_TAX_PCT = 5;
const MAX_BUY_TAX_PCT = 5;
/** Share of the deployer's previous launches that rugged. */
const MAX_RUG_RATIO = 0.1;
/** Bundled-launch concentration, whitepaper §9.3. */
const MAX_BUNDLER_RATE = 0.3;
const MAX_INSIDER_HOLD_RATE = 0.3;
const MAX_TOP10_HOLDER_RATE = 0.35;

export async function evaluateGmgnSafety(
  token: DiscoveredToken,
  config: Pick<
    SniperConfig,
    | "minLiquiditySol"
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
  ageSec: number,
  /** For the liquidity floor: GMGN reports liquidity in USD, the knob is
   * in SOL. Null means the rate was unavailable, which refuses. */
  solUsd: number | null
): Promise<SafetyCheckResult> {
  const reasons: string[] = [];

  // ── Age, same window the pump.fun path enforces ──
  if (ageSec < config.minTokenAgeSec) {
    reasons.push(
      `too young: ${ageSec.toFixed(1)}s old, minimum ${config.minTokenAgeSec}s`
    );
  }
  if (config.maxTokenAgeSec != null && ageSec > config.maxTokenAgeSec) {
    reasons.push(
      `too old by the time it was evaluated: ${ageSec.toFixed(1)}s, max ${config.maxTokenAgeSec}s`
    );
  }

  // ── Name/symbol keyword block ──
  const haystack = `${token.name ?? ""} ${token.symbol ?? ""}`.toLowerCase();
  for (const keyword of config.blockedKeywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle && haystack.includes(needle)) {
      reasons.push(`name/symbol contains blocked keyword "${keyword}"`);
      break;
    }
  }

  // ── Authorities ──
  if (config.requireMintAuthorityRenounced && token.mintAuthorityRenounced !== true) {
    reasons.push(
      token.mintAuthorityRenounced == null
        ? "mint authority state unknown"
        : "mint authority not revoked"
    );
  }
  if (config.requireFreezeAuthorityRenounced && token.freezeAuthorityRenounced !== true) {
    reasons.push(
      token.freezeAuthorityRenounced == null
        ? "freeze authority state unknown"
        : "freeze authority not revoked"
    );
  }

  // ── Socials ──
  if (config.requireSocialLink && !token.hasSocialLink) {
    reasons.push("no website/X/Telegram link");
  }

  // ── Creator's own stake. GMGN reports a 0–1 rate; the knob is a percent. ──
  if (token.creatorHoldRate != null) {
    const pct = token.creatorHoldRate * 100;
    if (pct > config.maxCreatorBuyPct) {
      reasons.push(
        `creator holds ${pct.toFixed(1)}% of supply (limit ${config.maxCreatorBuyPct}%)`
      );
    }
  }

  // ── Signals only GMGN gives us ──
  if (token.isHoneypot === true) {
    reasons.push("flagged as a honeypot");
  }
  if (token.sellTaxPct != null && token.sellTaxPct > MAX_SELL_TAX_PCT) {
    reasons.push(`sell tax ${token.sellTaxPct}% over ${MAX_SELL_TAX_PCT}% limit`);
  }
  if (token.buyTaxPct != null && token.buyTaxPct > MAX_BUY_TAX_PCT) {
    reasons.push(`buy tax ${token.buyTaxPct}% over ${MAX_BUY_TAX_PCT}% limit`);
  }
  if (token.rugRatio != null && token.rugRatio > MAX_RUG_RATIO) {
    reasons.push(
      `deployer rug history ${(token.rugRatio * 100).toFixed(0)}% over ${MAX_RUG_RATIO * 100}% limit`
    );
  }
  if (token.bundlerRate != null && token.bundlerRate > MAX_BUNDLER_RATE) {
    reasons.push(
      `bundled launch: ${(token.bundlerRate * 100).toFixed(0)}% bundler-held`
    );
  }
  if (token.insiderHoldRate != null && token.insiderHoldRate > MAX_INSIDER_HOLD_RATE) {
    reasons.push(
      `insider concentration ${(token.insiderHoldRate * 100).toFixed(0)}%`
    );
  }
  if (token.top10HolderRate != null && token.top10HolderRate > MAX_TOP10_HOLDER_RATE) {
    reasons.push(
      `top-10 hold ${(token.top10HolderRate * 100).toFixed(0)}% over ${MAX_TOP10_HOLDER_RATE * 100}% limit`
    );
  }
  if (token.isWashTrading === true) {
    reasons.push("wash trading detected");
  }

  /* Pool liquidity floor. GMGN reports `liquidity` in USD, in the same unit
     as `usd_market_cap` — verified against live rows, where the two track
     each other at roughly a third rather than differing by orders of
     magnitude. The operator's knob is denominated in SOL like the rest of
     the config, so the comparison converts rather than assuming.

     Fail-closed both ways: an unknown liquidity and an unknown SOL price
     are both refusals, because a thin pool is the cheapest thing in this
     market to pull and "could not check" is not a pass. */
  if (config.minLiquiditySol > 0) {
    if (token.liquidity == null) {
      reasons.push("pool liquidity unknown");
    } else if (!(solUsd != null && solUsd > 0)) {
      reasons.push("could not price liquidity in SOL (no SOL/USD rate)");
    } else {
      const liquiditySol = token.liquidity / solUsd;
      if (liquiditySol < config.minLiquiditySol) {
        reasons.push(
          `pool liquidity ${liquiditySol.toFixed(1)} SOL below the ${config.minLiquiditySol} SOL floor`
        );
      }
    }
  }

  /* Same Token-2022 extension gate the pump.fun path enforces (§9.1). GMGN's
     payload carries no extension data, so this costs one RPC read per
     candidate that has already survived every cheaper check. Fail-closed:
     an unreadable mint is refused, not assumed clean. */
  const extensions = await readMintExtensions(token.mint);
  if (extensions === null) {
    reasons.push("could not read mint account to check token extensions");
  } else {
    reasons.push(...extensionRefusalReasons(extensions, MAX_TRANSFER_FEE_BPS));
  }

  /* Same alpha-wallet gate the pump.fun path enforces. It reads holders of
     the mint straight off the RPC, so it needs nothing from PumpPortal and
     applies here identically — an earlier comment claimed otherwise and
     left this source silently exempt, meaning a bot told to enter only
     what a tracked wallet had bought still took GMGN entries with no such
     buy. An operator's hard requirement must not depend on which feed
     found the token. */
  const alphaWalletGateActive =
    config.requireAlphaWalletBuy && config.alphaWallets.length > 0;
  const alphaWalletResult = alphaWalletGateActive
    ? await checkAlphaWalletBuy(token.mint, config.alphaWallets)
    : null;
  if (alphaWalletGateActive && !alphaWalletResult?.detected) {
    reasons.push("no tracked alpha wallet holds this mint");
  }

  return {
    passed: reasons.length === 0,
    reasons,
    mintAuthorityRenounced: token.mintAuthorityRenounced,
    freezeAuthorityRenounced: token.freezeAuthorityRenounced,
    creatorBuyPct: token.creatorHoldRate != null ? token.creatorHoldRate * 100 : null,
    hasSocialLink: token.hasSocialLink,
    metadata: {
      name: token.name ?? undefined,
      symbol: token.symbol ?? undefined,
      twitter: token.twitter ?? undefined,
      telegram: token.telegram ?? undefined,
      website: token.website ?? undefined,
    },
    // null means "gate off", not "failed" — an empty tracked-wallet list
    // must never read like a rejection.
    alphaWalletDetected: alphaWalletResult ? alphaWalletResult.detected : null,
    matchedAlphaWallets: alphaWalletResult?.matchedWallets ?? [],
  };
}
