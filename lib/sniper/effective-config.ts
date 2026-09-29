import {
  getSniperConfig,
  type EntrySource,
  type SniperConfig,
} from "@/lib/sniper/config";

const BOOLEAN_KEYS: (keyof SniperConfig)[] = [
  "requireMintAuthorityRenounced",
  "requireFreezeAuthorityRenounced",
  "requireSocialLink",
  "trailingStopEnabled",
  "requireOwnerRenounced",
  "requireNoBlacklistCapability",
];

const NUMBER_KEYS: (keyof SniperConfig)[] = [
  "minLiquiditySol",
  "maxCreatorBuyPct",
  "minTokenAgeSec",
  "maxSolPerSnipe",
  "maxConcurrentPositions",
  "maxTotalDeployedSol",
  "takeProfitPct",
  "stopLossPct",
  "trailingStopActivationPct",
  "trailingStopPct",
  "crashDropPct",
  "exitCheckIntervalMs",
  "maxConsecutiveLosses",
  "maxDailyDrawdownSol",
  "cooldownAfterLossSec",
  "metadataFetchTimeoutMs",
];

const NULLABLE_NUMBER_KEYS: (keyof SniperConfig)[] = [
  "maxTokenAgeSec",
  "breakevenAfterPct",
  "maxHoldTimeSec",
  "maxCreatorHoldPct",
];

/** Keeps only known SniperConfig fields with the right primitive types — a
 * user's overlay can never introduce fields the daemon doesn't know. */
export function sanitize(raw: Record<string, unknown>): Partial<SniperConfig> {
  const out: Record<string, unknown> = {};
  for (const key of BOOLEAN_KEYS) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  for (const key of NUMBER_KEYS) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key])) out[key] = raw[key];
  }
  for (const key of NULLABLE_NUMBER_KEYS) {
    if (raw[key] === null || (typeof raw[key] === "number" && Number.isFinite(raw[key])))
      out[key] = raw[key];
  }
  if (raw.exitMode === "fixed" || raw.exitMode === "tiered") out.exitMode = raw.exitMode;
  /* An empty list would mean "no feed may open a position", which is a
     stopped bot expressed as a config value and almost certainly a mistake
     rather than an intent. Ignored, leaving the house default in place. */
  if (Array.isArray(raw.entrySources)) {
    const sources = raw.entrySources.filter(
      (s): s is EntrySource => s === "gmgn" || s === "pump"
    );
    if (sources.length > 0) out.entrySources = [...new Set(sources)];
  }
  if (Array.isArray(raw.blockedKeywords)) {
    out.blockedKeywords = raw.blockedKeywords
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 50);
  }
  if (Array.isArray(raw.takeProfitTiers)) {
    out.takeProfitTiers = raw.takeProfitTiers
      .filter(
        (t): t is { atPct: number; sellPortionPct: number } =>
          typeof t === "object" &&
          t !== null &&
          typeof (t as Record<string, unknown>).atPct === "number" &&
          typeof (t as Record<string, unknown>).sellPortionPct === "number"
      )
      .slice(0, 10);
  }
  return out as Partial<SniperConfig>;
}

/** A deployed bot's effective trading config: the house base config with
 * that bot's saved overlay applied on top — new bots start from the house
 * tune until a user changes something. Shared by the /deploy config panel
 * (app/api/my-bot/config/route.ts) and any execution loop that needs to
 * know what a specific bot is actually configured to do (e.g. a per-user
 * paper-trading daemon). */
export async function getEffectiveConfig(bot: {
  config: unknown;
}): Promise<SniperConfig> {
  const base = await getSniperConfig();
  const overlay = sanitize((bot.config ?? {}) as Record<string, unknown>);
  return { ...base, ...overlay };
}
