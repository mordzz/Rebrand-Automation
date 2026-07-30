import { gmgnGet, isGmgnConfigured } from "./client";

/**
 * Multi-launchpad token discovery via GMGN's `/v1/trenches`.
 *
 * This exists alongside the PumpPortal stream, never in place of it. The
 * two have opposite strengths and the engine wants both:
 *
 *   PumpPortal  — pump.fun only, but a push WebSocket: a mint arrives in
 *                 the same second it is created.
 *   GMGN        — every launchpad on the chain (bags, believe, letsbonk,
 *                 boop, heaven, moonshot, jup_studio, meteora, …) but
 *                 pull-based, so freshness is bounded by the poll cycle.
 *
 * Measured against live data, `new_creation` tokens come back 2–7 seconds
 * old, so the gap is smaller than "polled" suggests — but it is a gap,
 * and it is one-directional: GMGN widens the net rather than sharpening
 * it. Callers must not assume "just created" means "milliseconds ago".
 */

/** Every Solana launchpad GMGN indexes. Sent as an explicit allow-list
 * because the field is a filter: omitting it is fine, but sending an
 * empty array filters everything out. */
const SOL_LAUNCHPADS = [
  "Pump.fun", "pump_mayhem", "pump_mayhem_agent", "pump_agent",
  "letsbonk", "bonkers", "bags", "memoo", "liquid", "bankr", "zora",
  "surge", "anoncoin", "moonshot_app", "wendotdev", "heaven", "sugar",
  "token_mill", "believe", "trendsfun", "trends_fun", "jup_studio",
  "Moonshot", "boop", "ray_launchpad", "meteora_virtual_curve", "xstocks",
];

/** Quote-token types GMGN expects for Solana. Same allow-list semantics. */
const SOL_QUOTE_TYPES = [4, 5, 3, 1, 13, 0];

/** Bonding-curve lifecycle stage. `near_completion` comes back under the
 * key `pump` regardless of what was requested — GMGN's own quirk. */
export type TrenchStage = "new_creation" | "near_completion" | "completed";

export type DiscoveredToken = {
  mint: string;
  symbol: string | null;
  name: string | null;
  /** GMGN's own logo URL. NOT usable in a browser: gmgn.ai/external-res
   * answers 403 to any origin but their own (verified, including with a
   * full browser header set). Kept because it tells us an image exists,
   * but anything rendering it must resolve the real URL elsewhere — see
   * lib/jupiter/token-icons.ts, which app/api/discovery uses. */
  logo: string | null;
  launchpad: string | null;
  stage: TrenchStage;
  /** Unix seconds. */
  createdAt: number;
  /** SPL Token program generation; 2022 means Token-2022 extensions apply. */
  tokenStandard: string | null;

  // ── Authority state (same meaning as our own RPC-read fields) ──
  mintAuthorityRenounced: boolean | null;
  freezeAuthorityRenounced: boolean | null;

  // ── Social presence ──
  hasSocialLink: boolean;
  twitter: string | null;
  telegram: string | null;
  website: string | null;

  // ── Risk signals PumpPortal cannot give us ──
  isHoneypot: boolean | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  /** Share of the creator's past launches that rugged, 0–1. */
  rugRatio: number | null;
  top10HolderRate: number | null;
  /** Bundled-launch signal — whitepaper §9.3 in a single field. */
  bundlerRate: number | null;
  insiderHoldRate: number | null;
  creatorHoldRate: number | null;
  creatorLaunchCount: number | null;
  isWashTrading: boolean | null;
  /** >0 means this logo is reused from another token: copycat signal. */
  imageDup: number | null;

  // ── Market state ──
  marketCapUsd: number | null;
  /** Circulating supply, needed to turn market cap into a unit price. */
  totalSupply: number | null;
  liquidity: number | null;
  holderCount: number | null;
  /** Bonding-curve completion, 0–1. */
  progress: number | null;

  // ── Who is already in ──
  smartMoneyCount: number | null;
  kolCount: number | null;
};

type RawToken = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** GMGN sends booleans as real booleans, but leaves "unknown" as an empty
 * string rather than null (seen on is_honeypot / open_source for fresh
 * mints). Empty must stay null — treating unknown as false would quietly
 * turn "we could not check" into "it passed". */
function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return null;
}

function normalize(raw: RawToken, stage: TrenchStage): DiscoveredToken | null {
  const mint = str(raw.address);
  const createdAt = num(raw.created_timestamp);
  if (!mint || createdAt == null) return null;

  const twitter = str(raw.twitter);
  const telegram = str(raw.telegram);
  const website = str(raw.website);

  return {
    mint,
    symbol: str(raw.symbol),
    name: str(raw.name),
    logo: str(raw.logo),
    launchpad: str(raw.launchpad_platform) ?? str(raw.launchpad),
    stage,
    createdAt,
    tokenStandard: str(raw.standard),

    mintAuthorityRenounced: bool(raw.renounced_mint),
    freezeAuthorityRenounced: bool(raw.renounced_freeze_account),

    hasSocialLink:
      bool(raw.has_at_least_one_social) ??
      Boolean(twitter || telegram || website),
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
  };
}

/** GMGN returns `near_completion` under the key `pump`. */
const RESPONSE_KEY_TO_STAGE: Record<string, TrenchStage> = {
  new_creation: "new_creation",
  pump: "near_completion",
  near_completion: "near_completion",
  completed: "completed",
};

/**
 * Fresh launches across every indexed Solana launchpad.
 *
 * `stages` defaults to new_creation only: that is the population the
 * engine's entry thesis is about. Asking for `completed` here would hand
 * the engine tokens that already graduated, which its sizing and exit
 * rules were never designed for.
 */
export async function discoverTokens(
  stages: TrenchStage[] = ["new_creation"],
  limit = 80
): Promise<DiscoveredToken[]> {
  if (!isGmgnConfigured()) return [];

  const section = {
    filters: ["offchain", "onchain"],
    launchpad_platform_v2: true,
    limit,
    launchpad_platform: SOL_LAUNCHPADS,
    quote_address_type: SOL_QUOTE_TYPES,
  };
  const body: Record<string, unknown> = { version: "v2" };
  for (const stage of stages) body[stage] = { ...section };

  const data = await gmgnGet<Record<string, RawToken[]>>(
    "/v1/trenches",
    { chain: "sol" },
    { method: "POST", body }
  );
  if (!data) return [];

  const out: DiscoveredToken[] = [];
  for (const [key, list] of Object.entries(data)) {
    const stage = RESPONSE_KEY_TO_STAGE[key];
    if (!stage || !Array.isArray(list)) continue;
    for (const raw of list) {
      const token = normalize(raw, stage);
      if (token) out.push(token);
    }
  }

  // Newest first, and de-duplicated: the same mint can legitimately appear
  // under two stages when it graduates between the per-stage queries.
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((t) => (seen.has(t.mint) ? false : (seen.add(t.mint), true)));
}

/**
 * Entry price in SOL per token, matching the unit lib/sniper/exit-price.ts
 * returns for exits. Derived from GMGN's USD market cap over supply, then
 * converted at spot SOL/USD.
 *
 * Why not just quote DexScreener like the exit path does: measured live,
 * it has no data for a mint this fresh (3 of 12 fresh mints resolved, and
 * those returned a literal 0). Opening a position on a zero or missing
 * entry price would poison every P&L figure derived from it.
 *
 * Returns null when any input is missing — the caller must skip the
 * candidate rather than guess, since a wrong entry price is worse than a
 * missed trade.
 */
export function deriveEntryPriceSol(
  token: DiscoveredToken,
  solUsd: number
): number | null {
  if (!token.marketCapUsd || !token.totalSupply || solUsd <= 0) return null;
  if (token.marketCapUsd <= 0 || token.totalSupply <= 0) return null;

  const usdPerToken = token.marketCapUsd / token.totalSupply;
  const solPerToken = usdPerToken / solUsd;
  return Number.isFinite(solPerToken) && solPerToken > 0 ? solPerToken : null;
}
