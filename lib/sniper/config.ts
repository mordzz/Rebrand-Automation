import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { sniperConfig, sniperConfigHistory, type SniperConfigRow } from "@/lib/db/schema";

export type TakeProfitTier = { atPct: number; sellPortionPct: number };

/**
 * Live trading configuration for the Sniper daemon — hot-reloadable, backed
 * by the sniper_config singleton row (see lib/db/schema.ts). The daemon
 * calls getSniperConfig() fresh every cycle, so a change here takes effect
 * without a restart, the same way sniper_state.tradingPaused already does.
 */
export type SniperConfig = {
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
};

/** Master switches — deliberately NOT in sniper_config. Restart-gated by
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

function rowToConfig(row: SniperConfigRow): SniperConfig {
  return {
    requireMintAuthorityRenounced: row.requireMintAuthorityRenounced,
    requireFreezeAuthorityRenounced: row.requireFreezeAuthorityRenounced,
    requireSocialLink: row.requireSocialLink,
    requireAlphaWalletBuy: row.requireAlphaWalletBuy,
    alphaWallets: row.alphaWallets,
    maxCreatorBuyPct: num(row.maxCreatorBuyPct),
    minTokenAgeSec: num(row.minTokenAgeSec),
    maxTokenAgeSec: numOrNull(row.maxTokenAgeSec),
    blockedKeywords: row.blockedKeywords,

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
  };
}

/** Fallback used only when DATABASE_URL isn't configured at all — the
 * daemon still runs in detect-only mode in that case (see main()). */
function envSeededDefaults(): SniperConfig {
  return {
    requireMintAuthorityRenounced: true,
    requireFreezeAuthorityRenounced: true,
    requireSocialLink: true,
    requireAlphaWalletBuy: false,
    alphaWallets: [],
    maxCreatorBuyPct: envNumber("SNIPER_MAX_CREATOR_BUY_PCT", 10),
    minTokenAgeSec: 0,
    maxTokenAgeSec: null,
    blockedKeywords: [],

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

    maxConsecutiveLosses: envNumber("SNIPER_MAX_CONSECUTIVE_LOSSES", 3),
    maxDailyDrawdownSol: envNumber("SNIPER_MAX_DAILY_DRAWDOWN_SOL", 0.1),
    cooldownAfterLossSec: 0,

    metadataFetchTimeoutMs: envNumber("SNIPER_METADATA_TIMEOUT_MS", 3000),
  };
}

/**
 * The control row is a singleton — auto-created on first read, seeded from
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
]);

/** Converts a partial SniperConfig (plain numbers/nulls) into the string-typed
 * partial expected by drizzle's numeric columns. */
function patchToRow(patch: ConfigPatch): Partial<SniperConfigRow> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    row[key] = NUMERIC_KEYS.has(key as keyof SniperConfig)
      ? value == null
        ? null
        : String(value)
      : value;
  }
  return row as Partial<SniperConfigRow>;
}

/**
 * Merges a patch into the live config, persists it, and records a
 * before/after snapshot in sniper_config_history — applied either by hand
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
