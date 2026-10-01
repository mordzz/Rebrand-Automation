import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { sniperConfig, sniperConfigHistory, type SniperConfigRow } from "@/drizzle/schema";

export type TakeProfitTier = { atPct: number; sellPortionPct: number };

/**
 * Live trading configuration for the Sniper daemon - hot-reloadable, backed
 * by the sniper_config singleton row (see drizzle/schema). The daemon
 * calls getSniperConfig() fresh every cycle, so a change here takes effect
 * without a restart, the same way sniper_state.tradingPaused already does.
 */
/** Which discovery feed is allowed to trigger an entry.
 *
 * They are not interchangeable. "pump" is PumpPortal's push stream: it
 * arrives in milliseconds but carries nothing except the create event, so
 * the only checks that can run against it are authorities, extensions,
 * keywords and socials - and pump.fun revokes both authorities on every
 * launch, so those two pass for essentially the whole venue. "gmgn" is
 * polled and a few seconds slower, but arrives with deployer rug history,
 * bundling, insider and top-10 concentration, honeypot and tax signals
 * already attached, which is what §9.3's Tier 2 actually needs.
 *
 * GMGN also indexes pump.fun, so preferring it costs coverage of the venue
 * nothing; it costs latency. */
export type EntrySource = "gmgn" | "pump";

export type SniperConfig = {
  /** Feeds permitted to open a position. Defaults to GMGN only: refuse by
   * default (Design Principle 1) applies to where a candidate came from as
   * much as to the candidate itself. */
  entrySources: EntrySource[];
  /** Floor on pool liquidity, in SOL. Whitepaper Appendix A.2 carried this
   * as a 20 SOL target marked "not enforced"; a thin pool is the cheapest
   * thing in this market to pull. */
  minLiquiditySol: number;

  // Entry filters (lib/sniper/safety-checks.ts)
  requireMintAuthorityRenounced: boolean;
  requireFreezeAuthorityRenounced: boolean;
  requireSocialLink: boolean;
  requireAlphaWalletBuy: boolean;
  alphaWallets: string[];
  maxCreatorBuyPct: number;
  minTokenAgeSec: number;
  maxTokenAgeSec: number | null;
  blockedKeywords: string[];

  // Robinhood/EVM-specific entry filters (PR06.5, lib/gmgn/safety-robinhood.ts).
  // Deliberate new EVM policy choices, not semantic translations of the
  // Solana fields above - those remain Solana-only and unchanged.
  /** Requires GMGN's `ownerRenounced` fact to be true. NOT the same
   * concept as requireMintAuthorityRenounced (Solana). */
  requireOwnerRenounced: boolean;
  /** Requires GMGN's `isBlacklistCapable` fact to be false. NOT the same
   * concept as requireFreezeAuthorityRenounced (Solana). */
  requireNoBlacklistCapability: boolean;
  /** Ceiling on the creator's CURRENT holding concentration
   * (creatorHoldRate), for Robinhood only - NOT the same fact as
   * maxCreatorBuyPct (Solana initial-buy %), which cannot be reliably
   * reconstructed on Robinhood. `null` means "not yet configured": the
   * Robinhood evaluator refuses with an explicit configuration blocker
   * rather than silently inheriting maxCreatorBuyPct's threshold or any
   * other default. */
  maxCreatorHoldPct: number | null;

  // Sizing (lib/sniper/risk-limits.ts)
  maxSolPerSnipe: number;
  maxConcurrentPositions: number;
  maxTotalDeployedSol: number;

  // Exit strategy (scripts/sniper-daemon.ts#checkExits)
  exitMode: "fixed" | "tiered";
  takeProfitPct: number;
  stopLossPct: number;
  takeProfitTiers: TakeProfitTier[];
  trailingStopEnabled: boolean;
  trailingStopActivationPct: number;
  trailingStopPct: number;
  breakevenAfterPct: number | null;
  maxHoldTimeSec: number | null;
  crashDropPct: number;
  exitCheckIntervalMs: number;

  // Circuit breaker (lib/sniper/risk-limits.ts)
  maxConsecutiveLosses: number;
  maxDailyDrawdownSol: number;
  cooldownAfterLossSec: number;

  metadataFetchTimeoutMs: number;

  // PR04 chain-neutral risk fields (schema foundation), now exposed here
  // for PR07's Robinhood paper trading to actually consume - see
  // lib/sniper/risk-limits-robinhood.ts. Deliberately nullable and
  // NOT seeded with any default value: choosing an ETH risk number is a
  // product decision this PR does not make. `null` (or nativeSymbol not
  // exactly "ETH") means "not yet configured", and
  // resolveRobinhoodNativeLimits() fails closed on that rather than
  // silently reinterpreting maxSolPerSnipe/maxTotalDeployedSol/
  // maxDailyDrawdownSol as ETH, or treating a historical Solana
  // nativeSymbol="SOL" backfill as ETH. Solana behavior never reads these
  // fields at all. */
  maxNativePerSnipe: number | null;
  maxNativeDeployed: number | null;
  maxDailyDrawdownNative: number | null;
  nativeSymbol: string | null;
};

/** Master switches - deliberately NOT in sniper_config. Restart-gated by
 * design: high friction for "does this process even get to exist" and
 * "is it allowed to send real transactions". */
export type SniperRuntimeFlags = {
  enabled: boolean;
  dryRun: boolean;
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return raw === "true";
}

export function loadSniperRuntimeFlags(): SniperRuntimeFlags {
  return {
    enabled: envBool("SNIPER_ENABLED", false),
    dryRun: envBool("SNIPER_DRY_RUN", true),
  };
}

const num = (v: string | null): number => Number(v);
const numOrNull = (v: string | null): number | null => (v == null ? null : Number(v));

/** Not a sniper_config column: these are defaults the per-agent overlay
 * (lib/sniper/effective-config.ts) is expected to override, so they are
 * seeded from the environment rather than requiring a schema migration. */
function defaultEntrySources(): EntrySource[] {
  const raw = process.env.SNIPER_ENTRY_SOURCES?.trim();
  if (!raw) return ["gmgn"];
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is EntrySource => s === "gmgn" || s === "pump");
  return parsed.length > 0 ? parsed : ["gmgn"];
}

function rowToConfig(row: SniperConfigRow): SniperConfig {
  return {
    entrySources: defaultEntrySources(),
    minLiquiditySol: envNumber("SNIPER_MIN_LIQUIDITY_SOL", 20),

    requireMintAuthorityRenounced: row.requireMintAuthorityRenounced,
    requireFreezeAuthorityRenounced: row.requireFreezeAuthorityRenounced,
    requireSocialLink: row.requireSocialLink,
    requireAlphaWalletBuy: row.requireAlphaWalletBuy,
    alphaWallets: row.alphaWallets,
    maxCreatorBuyPct: num(row.maxCreatorBuyPct),
    minTokenAgeSec: num(row.minTokenAgeSec),
    maxTokenAgeSec: numOrNull(row.maxTokenAgeSec),
    blockedKeywords: row.blockedKeywords,

    requireOwnerRenounced: row.requireOwnerRenounced,
    requireNoBlacklistCapability: row.requireNoBlacklistCapability,
    maxCreatorHoldPct: numOrNull(row.maxCreatorHoldPct),

    maxSolPerSnipe: num(row.maxSolPerSnipe),
    maxConcurrentPositions: num(row.maxConcurrentPositions),
    maxTotalDeployedSol: num(row.maxTotalDeployedSol),

    exitMode: row.exitMode === "tiered" ? "tiered" : "fixed",
    takeProfitPct: num(row.takeProfitPct),
    stopLossPct: num(row.stopLossPct),
    takeProfitTiers: row.takeProfitTiers,
    trailingStopEnabled: row.trailingStopEnabled,
    trailingStopActivationPct: num(row.trailingStopActivationPct),
    trailingStopPct: num(row.trailingStopPct),
    breakevenAfterPct: numOrNull(row.breakevenAfterPct),
    maxHoldTimeSec: numOrNull(row.maxHoldTimeSec),
    crashDropPct: num(row.crashDropPct),
    exitCheckIntervalMs: num(row.exitCheckIntervalMs),

    maxConsecutiveLosses: num(row.maxConsecutiveLosses),
    maxDailyDrawdownSol: num(row.maxDailyDrawdownSol),
    cooldownAfterLossSec: num(row.cooldownAfterLossSec),

    metadataFetchTimeoutMs: num(row.metadataFetchTimeoutMs),

    maxNativePerSnipe: numOrNull(row.maxNativePerSnipe),
    maxNativeDeployed: numOrNull(row.maxNativeDeployed),
    maxDailyDrawdownNative: numOrNull(row.maxDailyDrawdownNative),
    nativeSymbol: row.nativeSymbol,
  };
}

/** Fallback used only when DATABASE_URL isn't configured at all - the
 * daemon still runs in detect-only mode in that case (see main()).
 * Exported for testability (asserting the approved v1 defaults without
 * needing a live DB), not for use as a general-purpose config source. */
export function envSeededDefaults(): SniperConfig {
  return {
    entrySources: defaultEntrySources(),
    minLiquiditySol: envNumber("SNIPER_MIN_LIQUIDITY_SOL", 20),

    requireMintAuthorityRenounced: true,
    requireFreezeAuthorityRenounced: true,
    requireSocialLink: true,
    requireAlphaWalletBuy: false,
    alphaWallets: [],
    maxCreatorBuyPct: envNumber("SNIPER_MAX_CREATOR_BUY_PCT", 10),
    minTokenAgeSec: 0,
    maxTokenAgeSec: null,
    blockedKeywords: [],

    requireOwnerRenounced: true,
    requireNoBlacklistCapability: true,
    /* Approved v1 default (product decision): Robinhood creator-hold
     * ceiling of 10%, distinct from and never derived from
     * maxCreatorBuyPct (Solana, initial-buy %, unchanged). See
     * drizzle/0003_robinhood_v1_policy.sql for the DB-side counterpart. */
    maxCreatorHoldPct: 10,

    maxSolPerSnipe: envNumber("SNIPER_MAX_SOL_PER_SNIPE", 0.05),
    maxConcurrentPositions: envNumber("SNIPER_MAX_CONCURRENT_POSITIONS", 3),
    maxTotalDeployedSol: envNumber("SNIPER_MAX_TOTAL_DEPLOYED_SOL", 0.15),

    exitMode: "fixed",
    takeProfitPct: envNumber("SNIPER_TAKE_PROFIT_PCT", 50),
    stopLossPct: envNumber("SNIPER_STOP_LOSS_PCT", 20),
    takeProfitTiers: [],
    trailingStopEnabled: false,
    trailingStopActivationPct: 30,
    trailingStopPct: 15,
    breakevenAfterPct: null,
    maxHoldTimeSec: null,
    crashDropPct: envNumber("SNIPER_CRASH_DROP_PCT", 15),
    exitCheckIntervalMs: envNumber("SNIPER_EXIT_CHECK_INTERVAL_MS", 4000),

    /* Deliberately loose. This strategy targets a low win rate with an
       asymmetric payoff, so losing runs are its normal state rather than a
       fault signal. Measured on live paper data at a 22% win rate, a limit
       of 2 tripped once every 3.1 trades and a limit of 3 once every 6.6,
       which left agents paused essentially always. Capital harm is bounded
       by maxDailyDrawdownSol, which measures what actually matters; this
       counter exists only to catch a pathological run. */
    maxConsecutiveLosses: envNumber("SNIPER_MAX_CONSECUTIVE_LOSSES", 8),
    maxDailyDrawdownSol: envNumber("SNIPER_MAX_DAILY_DRAWDOWN_SOL", 0.1),
    cooldownAfterLossSec: 0,

    metadataFetchTimeoutMs: envNumber("SNIPER_METADATA_TIMEOUT_MS", 3000),

    /* No ETH risk numbers are chosen in PR07 - Robinhood paper entries
     * fail closed via resolveRobinhoodNativeLimits() until an operator
     * explicitly sets all three plus nativeSymbol="ETH". */
    maxNativePerSnipe: null,
    maxNativeDeployed: null,
    maxDailyDrawdownNative: null,
    nativeSymbol: null,
  };
}

/**
 * The control row is a singleton - auto-created on first read, seeded from
 * the legacy SNIPER_* env vars so an existing deployment's behavior doesn't
 * change the moment this table appears. Falls back to a pure in-memory
 * env-seeded config (not persisted) when DATABASE_URL isn't configured at
 * all, matching the daemon's existing "detect-only, no DB" degrade path.
 */
export async function getSniperConfig(): Promise<SniperConfig> {
  const db = getDb();
  if (!db) return envSeededDefaults();

  const [existing] = await db.select().from(sniperConfig).limit(1);
  if (existing) return rowToConfig(existing);

  const seed = envSeededDefaults();
  const [created] = await db
    .insert(sniperConfig)
    .values({
      maxCreatorBuyPct: String(seed.maxCreatorBuyPct),
      maxSolPerSnipe: String(seed.maxSolPerSnipe),
      maxConcurrentPositions: String(seed.maxConcurrentPositions),
      maxTotalDeployedSol: String(seed.maxTotalDeployedSol),
      takeProfitPct: String(seed.takeProfitPct),
      stopLossPct: String(seed.stopLossPct),
      crashDropPct: String(seed.crashDropPct),
      exitCheckIntervalMs: String(seed.exitCheckIntervalMs),
      maxConsecutiveLosses: String(seed.maxConsecutiveLosses),
      maxDailyDrawdownSol: String(seed.maxDailyDrawdownSol),
      metadataFetchTimeoutMs: String(seed.metadataFetchTimeoutMs),
    })
    .returning();
  return rowToConfig(created);
}

type ConfigPatch = Partial<SniperConfig>;

const NUMERIC_KEYS = new Set<keyof SniperConfig>([
  "maxCreatorBuyPct",
  "maxCreatorHoldPct",
  "minTokenAgeSec",
  "maxTokenAgeSec",
  "maxSolPerSnipe",
  "maxConcurrentPositions",
  "maxTotalDeployedSol",
  "takeProfitPct",
  "stopLossPct",
  "trailingStopActivationPct",
  "trailingStopPct",
  "breakevenAfterPct",
  "maxHoldTimeSec",
  "crashDropPct",
  "exitCheckIntervalMs",
  "maxConsecutiveLosses",
  "maxDailyDrawdownSol",
  "cooldownAfterLossSec",
  "metadataFetchTimeoutMs",
  "maxNativePerSnipe",
  "maxNativeDeployed",
  "maxDailyDrawdownNative",
]);

/** Converts a partial SniperConfig (plain numbers/nulls) into the string-typed
 * partial expected by drizzle's numeric columns. */
/**
 * Authoritative validation for maxCreatorHoldPct - a safety-critical
 * Robinhood threshold, not a cosmetic display number. Exported so
 * lib/sniper/effective-config.ts's per-bot sanitizer enforces the exact
 * same rule rather than re-deriving it, and so this is the one place
 * that rule lives. `null` means "unconfigured" (the Robinhood evaluator
 * treats that as a fail-closed configuration blocker) and is always
 * valid; a non-null value must be a finite number in [0, 100] - anything
 * else throws rather than silently clamping, because a clamped value
 * would misrepresent what the operator actually asked for on a check
 * that gates real money.
 */
export function validateMaxCreatorHoldPct(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("maxCreatorHoldPct must be null or a finite number");
  }
  if (value < 0 || value > 100) {
    throw new Error("maxCreatorHoldPct must be between 0 and 100");
  }
  return value;
}

/** Converts a partial SniperConfig (plain numbers/nulls) into the string-typed
 * partial expected by drizzle's numeric columns. This is the authoritative
 * write path - app/api/sniper/config/route.ts's PATCH handler passes an
 * untrusted request body straight to updateSniperConfig() with no prior
 * sanitize() call, so validation here is what actually protects the house
 * config, not just the per-bot overlay path. */
function patchToRow(patch: ConfigPatch): Partial<SniperConfigRow> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "maxCreatorHoldPct") {
      row[key] = valueToNumericColumn(validateMaxCreatorHoldPct(value));
      continue;
    }
    row[key] = NUMERIC_KEYS.has(key as keyof SniperConfig)
      ? value == null
        ? null
        : String(value)
      : value;
  }
  return row as Partial<SniperConfigRow>;
}

function valueToNumericColumn(value: number | null): string | null {
  return value == null ? null : String(value);
}

/**
 * Merges a patch into the live config, persists it, and records a
 * before/after snapshot in sniper_config_history - applied either by hand
 * from the dashboard ("user") or from an approved lesson ("lesson").
 */
export async function updateSniperConfig(
  patch: ConfigPatch,
  source: "user" | "lesson",
  lessonId?: string
): Promise<SniperConfig> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");

  const before = await getSniperConfig();
  const [existing] = await db.select().from(sniperConfig).limit(1);
  if (!existing) throw new Error("sniper_config row missing");

  const [updated] = await db
    .update(sniperConfig)
    .set({ ...patchToRow(patch), updatedAt: new Date() })
    .where(eq(sniperConfig.id, existing.id))
    .returning();
  const after = rowToConfig(updated);

  await db.insert(sniperConfigHistory).values({
    source,
    lessonId: lessonId ?? null,
    before,
    after,
  });

  return after;
}
