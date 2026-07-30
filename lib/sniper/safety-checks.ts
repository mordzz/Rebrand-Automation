import { address } from "@solana/kit";

import { getRpc } from "@/lib/solana/wallet";
import type { PumpPortalNewTokenEvent } from "@/lib/solana/pumpportal";
import { checkAlphaWalletBuy } from "./alpha-wallets";
import type { SniperConfig } from "./config";
import {
  extensionRefusalReasons,
  parseMintExtensions,
  type MintExtensionFacts,
} from "@/lib/sniper/token-extensions";

export type TokenMetadata = {
  name?: string;
  symbol?: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

export type SafetyCheckResult = {
  passed: boolean;
  reasons: string[]; // failure reasons; empty when passed
  mintAuthorityRenounced: boolean | null; // null = could not be read
  freezeAuthorityRenounced: boolean | null;
  creatorBuyPct: number | null;
  hasSocialLink: boolean | null; // null = metadata could not be fetched
  metadata: TokenMetadata | null;
  alphaWalletDetected: boolean | null; // null = check disabled/no-op (see passesAll)
  matchedAlphaWallets: string[];
};

/**
 * SPL Token Mint account layout (82 bytes, verified against solana.com/docs
 * and the SPL Token program source, not assumed):
 *   offset  0: mintAuthorityOption   u32 LE (0 = None, 1 = Some)
 *   offset  4: mintAuthority         32-byte pubkey (only valid if Some)
 *   offset 36: supply                u64 LE
 *   offset 44: decimals              u8
 *   offset 45: isInitialized         u8 (bool)
 *   offset 46: freezeAuthorityOption u32 LE
 *   offset 50: freezeAuthority       32-byte pubkey (only valid if Some)
 */
async function readMintAuthorities(
  mint: string,
  rpcUrl?: string | null
): Promise<{
  mintRenounced: boolean | null;
  freezeRenounced: boolean | null;
  /** null when the account could not be read at all, which the caller
   *  must treat as a refusal rather than as "no extensions". */
  extensions: MintExtensionFacts | null;
}> {
  try {
    const rpc = getRpc(rpcUrl);
    const { value } = await rpc
      .getAccountInfo(address(mint), { encoding: "base64" })
      .send();
    if (!value) return { mintRenounced: null, freezeRenounced: null, extensions: null };

    const bytes = Buffer.from(value.data[0], "base64");
    if (bytes.length < 82) {
      return { mintRenounced: null, freezeRenounced: null, extensions: null };
    }

    const mintAuthorityOption = bytes.readUInt32LE(0);
    const freezeAuthorityOption = bytes.readUInt32LE(46);

    return {
      mintRenounced: mintAuthorityOption === 0,
      freezeRenounced: freezeAuthorityOption === 0,
      // Same account read, no extra RPC: the extension trailer is in the
      // bytes we already have (§8.3 keeps Tier 0 at zero additional RPC).
      extensions: parseMintExtensions(bytes, String(value.owner)),
    };
  } catch {
    return { mintRenounced: null, freezeRenounced: null, extensions: null };
  }
}

/**
 * Pump.fun's off-chain metadata JSON (schema confirmed by fetching a real
 * token's `uri` live — {name, symbol, description, image, showName,
 * createdOn, twitter?, telegram?, website?}). IPFS gateways can hang, so
 * this is bounded by an AbortController timeout rather than the default
 * fetch behavior of waiting indefinitely.
 */
async function fetchTokenMetadata(
  uri: string,
  timeoutMs: number
): Promise<TokenMetadata | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(uri, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as TokenMetadata;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function hasAnySocialLink(metadata: TokenMetadata | null): boolean | null {
  if (!metadata) return null;
  return Boolean(
    metadata.twitter?.trim() || metadata.telegram?.trim() || metadata.website?.trim()
  );
}

/**
 * True keyword match against name/symbol — e.g. rejecting tokens that
 * copy-paste a well-known ticker to bait buyers, or contain words your own
 * lessons have flagged as scam patterns.
 */
function matchesBlockedKeyword(
  event: PumpPortalNewTokenEvent,
  blockedKeywords: string[]
): string | null {
  const haystack = `${event.name ?? ""} ${event.symbol ?? ""}`.toLowerCase();
  for (const keyword of blockedKeywords) {
    if (keyword.trim() && haystack.includes(keyword.trim().toLowerCase())) {
      return keyword;
    }
  }
  return null;
}

/**
 * Creator's own initial buy as a % of total supply at creation — a large
 * self-buy is the classic pre-migration pump.fun dump setup (there's no
 * traditional withdrawable LP to "unlock" on the bonding curve itself; the
 * real rug pattern here is the creator dumping their own holdings, not
 * pulling liquidity).
 */
function creatorBuyPercent(event: PumpPortalNewTokenEvent): number {
  const totalSupply = event.initialBuy + event.vTokensInBondingCurve;
  if (totalSupply <= 0) return 0;
  return (event.initialBuy / totalSupply) * 100;
}

/**
 * v1 scope, stated plainly:
 * - Checked (each individually toggleable via SniperConfig, on by default):
 *   mint authority renounced, freeze authority renounced, at least one
 *   social link (twitter/telegram/website) in off-chain metadata.
 * - Checked, off by default (config.requireAlphaWalletBuy): whether any
 *   wallet in config.alphaWallets currently holds this mint (see
 *   lib/sniper/alpha-wallets.ts). Detected by polling getTokenAccountsByOwner
 *   on the RPC this project already has configured, not by subscribing to a
 *   trade stream — PumpPortal's subscribeAccountTrade/subscribeTokenTrade
 *   now require their own paid API key + funded wallet. A no-op while
 *   alphaWallets is empty — an empty tracked-wallet list must never behave
 *   like "reject everything".
 * - Checked: creator's initial-buy percentage (see creatorBuyPercent above)
 *   against config.maxCreatorBuyPct, and a name/symbol keyword blocklist.
 * - Checked: an age window against `ageSec` — how long *our own process*
 *   has held this event before evaluating it (see the queue in
 *   scripts/sniper-daemon.ts). PumpPortal's create event carries no
 *   timestamp field of its own (confirmed by inspecting a live event), so
 *   this is measured from local receipt time, which for a real-time WS
 *   stream is effectively the same as on-chain creation time.
 * - Restricted to pool==="pump" (native, not-yet-migrated bonding-curve
 *   tokens) — the most standardized surface for v1.
 * - NOT checked, a real acknowledged gap: true LP-locked-or-burned
 *   verification for tokens that have migrated past the bonding curve
 *   (out of scope anyway, since v1 only snipes pool==="pump"). Holder
 *   concentration beyond the creator's own initial buy (e.g. other early
 *   buyers already colluding) is also not checked.
 * - NOT using `vSolInBondingCurve` as a "liquidity floor": a live sample
 *   event showed this is ~30 SOL for a brand-new token regardless of the
 *   token itself — it looks like pump.fun's bonding curve initializes with
 *   a fixed virtual SOL reserve at t=0, so it doesn't discriminate risk at
 *   creation time (it would matter for judging *progress* on an older
 *   token, not a new one). Including it as a "safety" filter here would be
 *   theater, not a real check, so it's left out rather than implemented
 *   for appearance's sake.
 */
export type TokenSafetyData = {
  mintAuthorityRenounced: boolean | null;
  freezeAuthorityRenounced: boolean | null;
  metadata: TokenMetadata | null;
  /** null when the mint account could not be read; see evaluateSafety,
   *  which refuses rather than assuming a clean mint. */
  extensions: MintExtensionFacts | null;
};

/**
 * The token-level I/O in passesAll — an RPC mint-authority read and an IPFS
 * metadata fetch — is identical for a given event regardless of whose
 * config is being checked against it. A caller evaluating one token against
 * many configs at once (e.g. a multi-tenant paper daemon) should call this
 * once per token and reuse the result via evaluateSafety per config,
 * instead of re-fetching the same shared data once per user against a
 * rate-limited public RPC.
 */
export async function fetchTokenSafetyData(
  event: PumpPortalNewTokenEvent,
  metadataFetchTimeoutMs: number,
  /** Optional per-bot RPC (see lib/db/schema.ts#userBots.rpcUrl). Omitted
   * uses the shared endpoint, which is what the house path always does. */
  rpcUrl?: string | null
): Promise<TokenSafetyData> {
  const [{ mintRenounced, freezeRenounced, extensions }, metadata] = await Promise.all([
    readMintAuthorities(event.mint, rpcUrl),
    fetchTokenMetadata(event.uri, metadataFetchTimeoutMs),
  ]);
  return {
    mintAuthorityRenounced: mintRenounced,
    freezeAuthorityRenounced: freezeRenounced,
    metadata,
    extensions,
  };
}

/**
 * Per-config evaluation against already-fetched shared token data (see
 * fetchTokenSafetyData). Still does its own I/O for the alpha-wallet check,
 * which — unlike the mint-authority/metadata reads — is genuinely per-user
 * (different configs track different wallets) and off by default, so most
 * callers pay nothing extra here.
 */
export { MAX_TRANSFER_FEE_BPS };

/** Reads a mint's extension trailer on its own, for entry paths that do not
 * go through fetchTokenSafetyData (see lib/gmgn/safety.ts). Returns null when
 * the account could not be read, which callers must treat as a refusal. */
export async function readMintExtensions(
  mint: string,
  rpcUrl?: string | null
): Promise<MintExtensionFacts | null> {
  return (await readMintAuthorities(mint, rpcUrl)).extensions;
}

/** Platform floor for a Token-2022 transfer fee, in basis points. Fixed
 * rather than configurable: a 5% round-trip tax already dominates most
 * memecoin theses, and an operator raising it is not expressing risk
 * appetite so much as agreeing to be taxed. */
const MAX_TRANSFER_FEE_BPS = 500;


export async function evaluateSafety(
  event: PumpPortalNewTokenEvent,
  tokenData: TokenSafetyData,
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
): Promise<SafetyCheckResult> {
  const reasons: string[] = [];

  if (event.pool !== "pump") {
    reasons.push(`pool "${event.pool}" is out of scope for v1 (pump only)`);
  }

  if (ageSec < config.minTokenAgeSec) {
    reasons.push(
      `too young — ${ageSec.toFixed(1)}s old, minimum ${config.minTokenAgeSec}s`
    );
  }
  if (config.maxTokenAgeSec != null && ageSec > config.maxTokenAgeSec) {
    reasons.push(
      `too old by the time it was evaluated — ${ageSec.toFixed(1)}s, max ${config.maxTokenAgeSec}s`
    );
  }

  const blockedKeyword = matchesBlockedKeyword(event, config.blockedKeywords);
  if (blockedKeyword) {
    reasons.push(`name/symbol matches blocked keyword "${blockedKeyword}"`);
  }

  const alphaWalletGateActive =
    config.requireAlphaWalletBuy && config.alphaWallets.length > 0;
  const alphaWalletResult = alphaWalletGateActive
    ? await checkAlphaWalletBuy(event.mint, config.alphaWallets)
    : null;

  const mintRenounced = tokenData.mintAuthorityRenounced;
  const freezeRenounced = tokenData.freezeAuthorityRenounced;
  const metadata = tokenData.metadata;

  if (config.requireMintAuthorityRenounced || config.requireFreezeAuthorityRenounced) {
    if (mintRenounced === null || freezeRenounced === null) {
      reasons.push("could not read mint account to verify authorities");
    } else {
      if (config.requireMintAuthorityRenounced && !mintRenounced) {
        reasons.push("mint authority not renounced");
      }
      if (config.requireFreezeAuthorityRenounced && !freezeRenounced) {
        reasons.push("freeze authority not renounced");
      }
    }
  }

  /* Token-2022 extension gate (§9.1). Unconditional, not behind a config
     flag: these are not risk preferences but conditions under which an exit
     may be impossible, and the fee-authority case is the one the whitepaper
     bolds because reading the current fee is not enough when the authority
     can raise it after entry.

     Fail-closed (§9.4): a mint we could not read is refused, never assumed
     clean. That is stricter than the authority check above, which only
     objects when the operator asked for those authorities to be renounced. */
  if (tokenData.extensions === null) {
    reasons.push("could not read mint account to check token extensions");
  } else {
    reasons.push(
      ...extensionRefusalReasons(tokenData.extensions, MAX_TRANSFER_FEE_BPS)
    );
  }

  const creatorPct = creatorBuyPercent(event);
  if (creatorPct > config.maxCreatorBuyPct) {
    reasons.push(
      `creator bought ${creatorPct.toFixed(1)}% of supply at creation (limit ${config.maxCreatorBuyPct}%)`
    );
  }

  const socialLink = hasAnySocialLink(metadata);
  if (config.requireSocialLink) {
    if (socialLink === null) {
      reasons.push("could not fetch token metadata to check for a social link");
    } else if (!socialLink) {
      reasons.push("no website/X/Telegram link in token metadata");
    }
  }

  if (alphaWalletGateActive && !alphaWalletResult?.detected) {
    reasons.push("no tracked alpha wallet has bought this token yet");
  }

  return {
    passed: reasons.length === 0,
    reasons,
    mintAuthorityRenounced: mintRenounced,
    freezeAuthorityRenounced: freezeRenounced,
    creatorBuyPct: creatorPct,
    hasSocialLink: socialLink,
    metadata,
    alphaWalletDetected: alphaWalletGateActive ? (alphaWalletResult?.detected ?? false) : null,
    matchedAlphaWallets: alphaWalletResult?.matchedWallets ?? [],
  };
}

/** Thin wrapper of fetchTokenSafetyData + evaluateSafety for single-config
 * callers (the house daemon) — fetches the shared token data and evaluates
 * it against one config in one call, same signature/behavior as before this
 * was split for multi-config reuse. */
export async function passesAll(
  event: PumpPortalNewTokenEvent,
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
    | "metadataFetchTimeoutMs"
  >,
  ageSec: number
): Promise<SafetyCheckResult> {
  const tokenData = await fetchTokenSafetyData(event, config.metadataFetchTimeoutMs);
  return evaluateSafety(event, tokenData, config, ageSec);
}
