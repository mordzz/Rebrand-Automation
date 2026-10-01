import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { sniperConfig, sniperConfigHistory, type SniperConfigRow } from "@/lib/db/schema";

export type TakeProfitTier = { atPct: number; sellPortionPct: number };

/**
 * Live trading configuration - hot-reloadable, backed by the sniper_config
 * singleton row (see lib/db/schema.ts). The daemon re-reads it on every
 * roster refresh, so a change takes effect without a restart.
 */
/** Which discovery feed is allowed to trigger an entry. GMGN is the only
 * active Robinhood discovery source. */
export type EntrySource = "gmgn" | "pump";

export type SniperConfig = {
  /** Feeds permitted to open a position. Defaults to GMGN only: refuse by
   * default applies to where a candidate came from as much as to the
   * candidate itself. */
  entrySources: EntrySource[];

  // Entry filters
  requireSocialLink: boolean;
  requireAlphaWalletBuy: boolean;
  alphaWallets: string[];
  minTokenAgeSec: number;
  maxTokenAgeSec: number | null;
  blockedKeywords: string[];

  // Robinhood/EVM safety policy (lib/gmgn/safety-robinhood.ts).
  /** Requires GMGN's `ownerRenounced` fact to be true. */
  requireOwnerRenounced: boolean;
  /** Requires GMGN's `isBlacklistCapable` fact to be false. */
  requireNoBlacklistCapability: boolean;
  /** Ceiling on the creator's CURRENT holding concentration
   * (creatorHoldRate). `null` means "not yet configured": the Robinhood
   * evaluator refuses with an explicit configuration blocker. */
  maxCreatorHoldPct: number | null;

  // Sizing
  maxConcurrentPositions: number;

  // Exit strategy (lib/sniper/exit-logic.ts)
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

  // Circuit breaker
  maxConsecutiveLosses: number;
  cooldownAfterLossSec: number;

  metadataFetchTimeoutMs: number;

  /* Robinhood native risk limits (lib/sniper/risk-limits-robinhood.ts).
   * Default to the approved ETH product constants (see
   * DEFAULT_TRADING_CONFIG). An operator may still null one out: `null`
   * (or nativeSymbol not exactly "ETH") means "not configured", and
   * resolveRobinhoodNativeLimits() fails closed on that. */
  maxNativePerSnipe: number | null;
  maxNativeDeployed: number | null;
  maxDailyDrawdownNative: number | null;
  nativeSymbol: string | null;
};

/**
 * Product defaults. Mirrors the sniper_config column defaults in
 * lib/db/schema.ts (asserted equal by tests/gmgn.ts) and
 * is used directly only when DATABASE_URL isn't configured at all.
 */
export const DEFAULT_TRADING_CONFIG: Readonly<SniperConfig> = Object.freeze({
  entrySources: ["gmgn"],

  requireSocialLink: true,
  requireAlphaWalletBuy: false,
  alphaWallets: [],
  minTokenAgeSec: 0,
  maxTokenAgeSec: null,
  blockedKeywords: [],

  requireOwnerRenounced: true,
  requireNoBlacklistCapability: true,
  maxCreatorHoldPct: 10,

  maxConcurrentPositions: 3,

  exitMode: "fixed",
  takeProfitPct: 50,
  stopLossPct: 20,
  takeProfitTiers: [],
  trailingStopEnabled: false,
  trailingStopActivationPct: 30,
  trailingStopPct: 15,
  breakevenAfterPct: null,
  maxHoldTimeSec: null,
  crashDropPct: 15,
  exitCheckIntervalMs: 4000,

  maxConsecutiveLosses: 8,
  cooldownAfterLossSec: 0,

  metadataFetchTimeoutMs: 3000,

  // The original engine's 0.05 / 0.15 / 0.1 SOL defaults converted to ETH
  // at the same fiat value as the live fee (1 SOL = 0.04385 ETH).
  maxNativePerSnipe: 0.0022,
  maxNativeDeployed: 0.0066,
  maxDailyDrawdownNative: 0.0044,
  nativeSymbol: "ETH",
} satisfies SniperConfig);

/** A fresh, mutable copy of the product defaults. */
export function defaultSniperConfig(): SniperConfig {
  return structuredClone(DEFAULT_TRADING_CONFIG) as SniperConfig;
}

const num = (v: string | null): number => Number(v);
const numOrNull = (v: string | null): number | null => (v == null ? null : Number(v));

function rowToConfig(row: SniperConfigRow): SniperConfig {
  return {
    // Not a column: GMGN is the only active source, and a per-bot overlay
    // may narrow it (lib/sniper/effective-config.ts).
    entrySources: [...DEFAULT_TRADING_CONFIG.entrySources],

    requireSocialLink: row.requireSocialLink,
    requireAlphaWalletBuy: row.requireAlphaWalletBuy,
    alphaWallets: row.alphaWallets,
    minTokenAgeSec: num(row.minTokenAgeSec),
    maxTokenAgeSec: numOrNull(row.maxTokenAgeSec),
    blockedKeywords: row.blockedKeywords,

    requireOwnerRenounced: row.requireOwnerRenounced,
    requireNoBlacklistCapability: row.requireNoBlacklistCapability,
    maxCreatorHoldPct: numOrNull(row.maxCreatorHoldPct),

    maxConcurrentPositions: num(row.maxConcurrentPositions),

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
    cooldownAfterLossSec: num(row.cooldownAfterLossSec),

    metadataFetchTimeoutMs: num(row.metadataFetchTimeoutMs),

    maxNativePerSnipe: numOrNull(row.maxNativePerSnipe),
    maxNativeDeployed: numOrNull(row.maxNativeDeployed),
    maxDailyDrawdownNative: numOrNull(row.maxDailyDrawdownNative),
    nativeSymbol: row.nativeSymbol,
  };
}

/**
 * The control row is a singleton - auto-created on first read from the
 * schema's column defaults. Falls back to the in-memory product defaults
 * (not persisted) when DATABASE_URL isn't configured at all.
 */
export async function getSniperConfig(): Promise<SniperConfig> {
  const db = getDb();
  if (!db) return defaultSniperConfig();

  const [existing] = await db.select().from(sniperConfig).limit(1);
  if (existing) return rowToConfig(existing);

  const [created] = await db.insert(sniperConfig).values({}).returning();
  return rowToConfig(created);
}

type ConfigPatch = Partial<SniperConfig>;

const NUMERIC_KEYS = new Set<keyof SniperConfig>([
  "maxCreatorHoldPct",
  "minTokenAgeSec",
  "maxTokenAgeSec",
  "maxConcurrentPositions",
  "takeProfitPct",
  "stopLossPct",
  "trailingStopActivationPct",
  "trailingStopPct",
  "breakevenAfterPct",
  "maxHoldTimeSec",
  "crashDropPct",
  "exitCheckIntervalMs",
  "maxConsecutiveLosses",
  "cooldownAfterLossSec",
  "metadataFetchTimeoutMs",
  "maxNativePerSnipe",
  "maxNativeDeployed",
  "maxDailyDrawdownNative",
]);

/**
 * Authoritative validation for maxCreatorHoldPct - a safety-critical
 * Robinhood threshold, not a cosmetic display number. Exported so
 * lib/sniper/effective-config.ts's per-bot sanitizer enforces the exact
 * same rule. `null` means "unconfigured" (the Robinhood evaluator treats
 * that as a fail-closed configuration blocker) and is always valid; a
 * non-null value must be a finite number in [0, 100] - anything else
 * throws rather than silently clamping.
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
 * untrusted request body straight to updateSniperConfig(), so validation
 * here is what actually protects the house config. */
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
