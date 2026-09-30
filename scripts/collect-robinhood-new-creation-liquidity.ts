/**
 * Read-only longitudinal collector for Robinhood `pons new_creation`
 * liquidity, run repeatedly over time to accumulate a larger dataset for
 * the still-open "is liquidity a useful safety discriminator" question.
 *
 * This does NOT choose a threshold, does NOT change any runtime safety
 * behavior, does NOT write to the application database, does NOT sign
 * or send any transaction. It only reads GMGN's public trenches/token-info
 * endpoints and appends normalized observations to a local, gitignored
 * JSONL dataset (data/robinhood-liquidity-snapshots.jsonl).
 *
 * Integrity contract: a provider failure, a malformed provider payload,
 * or a corrupted/invalid existing dataset line must NEVER be treated as
 * "empty market" or silently repaired — each aborts the run and leaves
 * the persisted dataset byte-for-byte unchanged. See
 * lib/gmgn/liquidity-collector.ts's parseDataset/mergeObservations.
 *
 * Run:
 *   npm run collect:robinhood-liquidity
 *   npm run collect:robinhood-liquidity -- --interval-minutes 5 --runs 12
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { dirname, join } from "path";
import { gmgnRequest } from "@/lib/gmgn/client";
import {
  buildObservationFromRaw,
  mergeObservations,
  computeStats,
  parseDataset,
  serializeDataset,
  type LiquidityObservation,
} from "@/lib/gmgn/liquidity-collector";

const DATASET_PATH = join(process.cwd(), "data", "robinhood-liquidity-snapshots.jsonl");
const LAUNCHPAD_ALLOWLIST = ["pons"]; // v1 scope only — see GMGN_ROBINHOOD_FIELD_MAP.md

/**
 * Loads the persisted dataset with fail-closed integrity. A corrupted or
 * schema-invalid line throws rather than returning a partial/repaired
 * dataset — callers must not call saveAll() after catching this.
 */
function loadExistingOrThrow(): LiquidityObservation[] {
  if (!existsSync(DATASET_PATH)) return [];
  const raw = readFileSync(DATASET_PATH, "utf8");
  const result = parseDataset(raw);
  if (!result.ok) {
    if (result.reason === "parse_error") {
      throw new Error(
        `dataset integrity error: line ${result.lineNumber} could not be parsed as JSON — dataset left untouched`
      );
    }
    throw new Error(
      `dataset integrity error: line ${result.lineNumber} failed schema validation (${result.detail}) — dataset left untouched`
    );
  }
  return result.observations;
}

/** Writes the full dataset via a temp-file + atomic rename, so a process
 * interrupted mid-write can never leave a truncated/corrupted dataset
 * behind. */
function saveAll(observations: readonly LiquidityObservation[]): void {
  mkdirSync(dirname(DATASET_PATH), { recursive: true });
  const tmpPath = `${DATASET_PATH}.tmp-${process.pid}`;
  writeFileSync(tmpPath, serializeDataset(observations), "utf8");
  renameSync(tmpPath, DATASET_PATH);
}

type FetchNewCreationResult =
  | { ok: true; candidates: Record<string, unknown>[] }
  | { ok: false; reason: string };

/**
 * Fetches the current `pons new_creation` population. Returns a
 * discriminated result — `new_creation = []` is a VALID empty-market
 * snapshot (`ok: true, candidates: []`); a provider error, a missing
 * `new_creation` key, or a non-array `new_creation` are all collection
 * FAILURES (`ok: false`) and must never be treated as "no new tokens."
 */
async function fetchNewCreationCandidates(): Promise<FetchNewCreationResult> {
  const body: Record<string, unknown> = {
    version: "v2",
    new_creation: {
      filters: ["offchain", "onchain"],
      launchpad_platform_v2: true,
      limit: 80,
      launchpad_platform: LAUNCHPAD_ALLOWLIST,
    },
  };
  const result = await gmgnRequest<Record<string, unknown>>(
    "/v1/trenches",
    { chain: "robinhood" },
    { method: "POST", body }
  );
  if (!result.ok) {
    const detail =
      result.kind === "http_error"
        ? `HTTP ${result.status}`
        : result.kind === "api_error"
          ? `API error code ${result.code}${result.msg ? `: ${result.msg}` : ""}`
          : result.kind === "not_configured"
            ? "GMGN_API_KEY not configured"
            : result.kind === "malformed_payload"
              ? `malformed_payload: ${result.detail}`
              : result.detail;
    return { ok: false, reason: detail };
  }

  const list = (result.data as Record<string, unknown>).new_creation;
  if (list === undefined) {
    return { ok: false, reason: "response is missing data.new_creation" };
  }
  if (!Array.isArray(list)) {
    return { ok: false, reason: `expected data.new_creation to be an array, got ${typeof list}` };
  }
  return { ok: true, candidates: list as Record<string, unknown>[] };
}

async function fetchTokenInfo(address: string): Promise<Record<string, unknown> | null> {
  const result = await gmgnRequest<Record<string, unknown>>("/v1/token/info", { chain: "robinhood", address });
  return result.ok ? result.data : null;
}

function num(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type RunOutcome =
  | { status: "OK"; raw: number; newCount: number; total: number }
  | { status: "PROVIDER_ERROR"; reason: string }
  | { status: "DATASET_INTEGRITY_ERROR"; reason: string };

async function runOneCollection(): Promise<RunOutcome> {
  const observedAt = new Date().toISOString();

  const fetchResult = await fetchNewCreationCandidates();
  if (!fetchResult.ok) {
    console.error(`[collector] collection FAILED — provider error: ${fetchResult.reason}`);
    console.error("[collector] collection status: PROVIDER_ERROR — dataset unchanged");
    return { status: "PROVIDER_ERROR", reason: fetchResult.reason };
  }

  const candidates = fetchResult.candidates;
  console.log(`[collector] raw candidates fetched: ${candidates.length}`);

  // Per-quote-address price cache — never assume every pool uses the same
  // quote token (see the hardened inspection script's earlier bug).
  const quotePriceByAddress = new Map<string, number | null>();

  const freshObservations: LiquidityObservation[] = [];

  for (const item of candidates) {
    const address = item.address as string | undefined;
    if (!address) continue;

    const info = await fetchTokenInfo(address);
    const pool = (info?.pool as Record<string, unknown> | undefined) ?? null;

    let quoteUsdPrice: number | null = null;
    const quoteAddressRaw = pool?.quote_address as string | undefined;
    if (quoteAddressRaw) {
      const key = quoteAddressRaw.toLowerCase();
      if (!quotePriceByAddress.has(key)) {
        const quoteInfo = await fetchTokenInfo(quoteAddressRaw);
        const price = num((quoteInfo?.price as Record<string, unknown> | undefined)?.price);
        quotePriceByAddress.set(key, price);
      }
      quoteUsdPrice = quotePriceByAddress.get(key) ?? null;
    }

    const observation = buildObservationFromRaw(item, pool, quoteUsdPrice, observedAt);
    if (observation) freshObservations.push(observation);
  }

  let existing: LiquidityObservation[];
  try {
    existing = loadExistingOrThrow();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[collector] collection FAILED — ${reason}`);
    console.error("[collector] collection status: DATASET_INTEGRITY_ERROR — dataset unchanged");
    return { status: "DATASET_INTEGRITY_ERROR", reason };
  }

  const { merged, newCount, alreadyKnownCount } = mergeObservations(existing, freshObservations);
  saveAll(merged);

  console.log(
    `[collector] already-known tokens this run: ${alreadyKnownCount}, new unique launches added: ${newCount}, total unique launches: ${merged.length}`
  );
  console.log("[collector] collection status: OK");

  return { status: "OK", raw: candidates.length, newCount, total: merged.length };
}

function printStats(): void {
  let observations: LiquidityObservation[];
  try {
    observations = loadExistingOrThrow();
  } catch (error) {
    console.error(`[collector] cannot print stats — ${error instanceof Error ? error.message : error}`);
    return;
  }
  const stats = computeStats(observations);

  console.log("\n=== Accumulated new_creation liquidity statistics (pons, v1 scope) ===");
  console.log(`total unique launches: ${stats.totalUniqueLaunches}`);
  console.log(`first observed: ${stats.firstTimestamp}`);
  console.log(`latest observed: ${stats.latestTimestamp}`);
  console.log(`number with usable liquidity: ${stats.numberWithUsableLiquidity}`);
  console.log(`number with liquidity = 0: ${stats.numberWithZeroLiquidity}`);
  console.log(`number with liquidity > 0: ${stats.numberWithPositiveLiquidity}`);
  console.log(
    `quantile method = linear interpolation, index=(n-1)*p, Type-7 — min=${stats.min} p10=${stats.p10} p25=${stats.p25} median=${stats.median} p75=${stats.p75} p90=${stats.p90} p95=${stats.p95} max=${stats.max} mean=${stats.mean}`
  );
  console.log(`coefficient of variation: ${stats.coefficientOfVariation}`);
  console.log(`distinct liquidity values: ${stats.distinctLiquidityValueCount}`);
  console.log(`pct exactly zero: ${stats.pctExactlyZero}`);
  for (const [label, count] of Object.entries(stats.bucketCounts)) {
    console.log(`  count ${label}: ${count} (${stats.pctBelow[label]?.toFixed(1)}%)`);
  }
  console.log(`\nsample status: ${stats.status}`);
  console.log(
    stats.status === "DATASET_TOO_SMALL"
      ? `(need ${30 - stats.totalUniqueLaunches} more unique launches for policy review — no threshold decision made here)`
      : "(sample size is sufficient to bring the threshold/usefulness question back for human review — this script does not make that decision)"
  );
}

function parseArgs(): { intervalMinutes: number | null; runs: number } {
  const args = process.argv.slice(2);
  let intervalMinutes: number | null = null;
  let runs = 1;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--interval-minutes") intervalMinutes = Number(args[++i]);
    if (args[i] === "--runs") runs = Number(args[++i]);
  }
  if (intervalMinutes != null && intervalMinutes < 1) {
    throw new Error("--interval-minutes must be >= 1 (no faster-than-1-minute polling of GMGN)");
  }
  return { intervalMinutes, runs };
}

async function main() {
  const { intervalMinutes, runs } = parseArgs();

  let stopped = false;
  process.on("SIGINT", () => {
    console.log("\n[collector] SIGINT received, stopping after current run...");
    stopped = true;
  });

  const totalRuns = intervalMinutes ? runs : 1;
  const isMultiRun = intervalMinutes != null;
  let anyDatasetIntegrityError = false;
  let anyProviderError = false;
  for (let i = 0; i < totalRuns && !stopped; i++) {
    console.log(`\n--- collection run ${i + 1}/${totalRuns} ---`);
    const outcome = await runOneCollection();
    if (outcome.status === "DATASET_INTEGRITY_ERROR") {
      anyDatasetIntegrityError = true;
      break; // do not keep polling against a dataset we know is corrupted
    }
    if (outcome.status === "PROVIDER_ERROR") {
      anyProviderError = true;
      // One-shot mode: a provider failure is the whole invocation's
      // result — stop immediately rather than printing stats as if
      // nothing went wrong. Multi-run mode: transient 429s are expected
      // during development, so continue to the next scheduled run.
      if (!isMultiRun) break;
    }
    if (intervalMinutes && i < totalRuns - 1 && !stopped) {
      console.log(`[collector] sleeping ${intervalMinutes} minute(s) before next run...`);
      await new Promise((resolve) => setTimeout(resolve, intervalMinutes * 60_000));
    }
  }

  if (anyDatasetIntegrityError) {
    console.error("[collector] stopped due to a dataset integrity error — fix the dataset file before re-running.");
    process.exitCode = 1;
    return;
  }

  if (anyProviderError) {
    console.error(
      isMultiRun
        ? "[collector] one or more runs in this session failed with a provider error — see PROVIDER_ERROR lines above. Dataset was left unchanged for each failed run."
        : "[collector] the collection run failed with a provider error — dataset left unchanged."
    );
    process.exitCode = 1;
    if (!isMultiRun) return; // one-shot: do not print stats after the sole run failed
  }

  printStats();
}

main().catch((e) => {
  console.error("fatal", e);
  process.exitCode = 1;
});
