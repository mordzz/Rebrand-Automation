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
  type LiquidityObservation,
} from "@/lib/gmgn/liquidity-collector";

const DATASET_PATH = join(process.cwd(), "data", "robinhood-liquidity-snapshots.jsonl");
const LAUNCHPAD_ALLOWLIST = ["pons"]; // v1 scope only — see GMGN_ROBINHOOD_FIELD_MAP.md

function loadExisting(): LiquidityObservation[] {
  if (!existsSync(DATASET_PATH)) return [];
  const raw = readFileSync(DATASET_PATH, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const observations: LiquidityObservation[] = [];
  for (const line of lines) {
    try {
      observations.push(JSON.parse(line) as LiquidityObservation);
    } catch {
      // Skip a corrupted line rather than crash the whole collector run.
      console.warn("[collector] skipping unparseable dataset line");
    }
  }
  return observations;
}

/** Writes the full dataset via a temp-file + atomic rename, so a process
 * interrupted mid-write can never leave a truncated/corrupted dataset
 * behind. */
function saveAll(observations: readonly LiquidityObservation[]): void {
  mkdirSync(dirname(DATASET_PATH), { recursive: true });
  const tmpPath = `${DATASET_PATH}.tmp-${process.pid}`;
  const body = observations.map((o) => JSON.stringify(o)).join("\n") + (observations.length > 0 ? "\n" : "");
  writeFileSync(tmpPath, body, "utf8");
  renameSync(tmpPath, DATASET_PATH);
}

async function fetchNewCreationCandidates(): Promise<Record<string, unknown>[]> {
  const body: Record<string, unknown> = {
    version: "v2",
    new_creation: {
      filters: ["offchain", "onchain"],
      launchpad_platform_v2: true,
      limit: 80,
      launchpad_platform: LAUNCHPAD_ALLOWLIST,
    },
  };
  const result = await gmgnRequest<Record<string, unknown[]>>(
    "/v1/trenches",
    { chain: "robinhood" },
    { method: "POST", body }
  );
  if (!result.ok) {
    console.error("[collector] fetchNewCreationCandidates failed:", result);
    return [];
  }
  const list = result.data.new_creation;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
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

async function runOneCollection(): Promise<{ raw: number; newCount: number; total: number }> {
  const observedAt = new Date().toISOString();

  const candidates = await fetchNewCreationCandidates();
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

  const existing = loadExisting();
  const { merged, newCount, alreadyKnownCount } = mergeObservations(existing, freshObservations);
  saveAll(merged);

  console.log(
    `[collector] already-known tokens this run: ${alreadyKnownCount}, new unique launches added: ${newCount}, total unique launches: ${merged.length}`
  );

  return { raw: candidates.length, newCount, total: merged.length };
}

function printStats(): void {
  const observations = loadExisting();
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
  for (let i = 0; i < totalRuns && !stopped; i++) {
    console.log(`\n--- collection run ${i + 1}/${totalRuns} ---`);
    await runOneCollection();
    if (intervalMinutes && i < totalRuns - 1 && !stopped) {
      console.log(`[collector] sleeping ${intervalMinutes} minute(s) before next run...`);
      await new Promise((resolve) => setTimeout(resolve, intervalMinutes * 60_000));
    }
  }

  printStats();
}

main().catch((e) => {
  console.error("fatal", e);
  process.exitCode = 1;
});
