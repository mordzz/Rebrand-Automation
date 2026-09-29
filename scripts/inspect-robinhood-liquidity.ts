/**
 * Read-only investigation script for Robinhood/GMGN liquidity semantics.
 *
 * Never signs a transaction, never requires a private key. Uses the
 * configured GMGN_API_KEY (server-side env var) and the PR03 read-only
 * RPC layer for on-chain cross-checks. Prints only public on-chain data
 * and public GMGN market data — no secrets are logged (the API key
 * itself is never printed).
 *
 * Purpose: gather evidence for the still-open "is GMGN Robinhood
 * `liquidity` really USD, and is it a useful safety discriminator"
 * question. Does NOT change any runtime safety behavior — this is
 * investigation-only, per the accompanying task instructions.
 *
 * Run: npm run inspect:robinhood-liquidity
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { gmgnRequest } from "@/lib/gmgn/client";
import { createPublicClient, http, defineChain } from "viem";

// GMGN's Robinhood market data indexes MAINNET (chain id 4663) — the
// repo's configured PR03 RPC client defaults to testnet
// (NEXT_PUBLIC_ROBINHOOD_NETWORK), which would return no bytecode for
// any of these addresses (confirmed during the earlier Pons
// investigation). This script needs mainnet specifically to cross-check
// real GMGN-reported tokens/pools, so it defines its own read-only
// mainnet client rather than reusing the network-configurable one.
const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});
function getMainnetClient() {
  return createPublicClient({ chain: robinhoodMainnet, transport: http() });
}

type TrenchItem = Record<string, unknown>;

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

async function fetchTrenches(stage: "new_creation" | "near_completion" | "completed", limit: number): Promise<TrenchItem[]> {
  const key = stage === "near_completion" ? "pump" : stage; // GMGN's own quirk, see lib/gmgn/discovery.ts
  const body: Record<string, unknown> = { version: "v2" };
  body[stage] = {
    filters: ["offchain", "onchain"],
    launchpad_platform_v2: true,
    limit,
    launchpad_platform: ["pons"],
  };
  const result = await gmgnRequest<Record<string, unknown[]>>("/v1/trenches", { chain: "robinhood" }, { method: "POST", body });
  if (!result.ok) {
    console.error(`  [fetchTrenches ${stage}] failed:`, result);
    return [];
  }
  const list = result.data[key];
  return Array.isArray(list) ? (list as TrenchItem[]) : [];
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

type Sample = {
  address: string;
  stage: string;
  poolAddress: string | null;
  quoteAddress: string | null;
  quoteSymbol: string | null;
  baseReserve: number | null;
  quoteReserve: number | null;
  baseReserveValue: number | null;
  quoteReserveValue: number | null;
  liquidity: number | null;
  tokenPrice: number | null;
};

async function main() {
  console.log("=== Robinhood/GMGN liquidity investigation (read-only) ===\n");

  console.log("Fetching pons new_creation candidates...");
  const newCreation = await fetchTrenches("new_creation", 80);
  console.log(`  got ${newCreation.length} item(s)`);

  console.log("Fetching pons near_completion candidates (verification only — not enabled in Noah)...");
  const nearCompletion = await fetchTrenches("near_completion", 30);
  console.log(`  got ${nearCompletion.length} item(s)`);

  console.log("Fetching pons completed candidates (verification only — not enabled in Noah)...");
  const completed = await fetchTrenches("completed", 30);
  console.log(`  got ${completed.length} item(s)`);

  const allCandidates: { item: TrenchItem; stage: string }[] = [
    ...newCreation.map((item) => ({ item, stage: "new_creation" })),
    ...nearCompletion.map((item) => ({ item, stage: "near_completion" })),
    ...completed.map((item) => ({ item, stage: "completed" })),
  ];
  console.log(`\nTotal candidates fetched: ${allCandidates.length}\n`);

  const samples: Sample[] = [];
  let quoteTokenPriceUsd: number | null = null;
  let quoteTokenAddress: string | null = null;

  for (const { item, stage } of allCandidates) {
    const address = item.address as string;
    const info = await fetchTokenInfo(address);
    if (!info) continue;
    const pool = info.pool as Record<string, unknown> | undefined;
    if (!pool) continue;

    const sample: Sample = {
      address,
      stage,
      poolAddress: (pool.pool_address as string) ?? null,
      quoteAddress: (pool.quote_address as string) ?? null,
      quoteSymbol: (pool.quote_symbol as string) ?? null,
      baseReserve: num(pool.base_reserve),
      quoteReserve: num(pool.quote_reserve),
      baseReserveValue: num(pool.base_reserve_value),
      quoteReserveValue: num(pool.quote_reserve_value),
      liquidity: num(pool.liquidity ?? info.liquidity),
      tokenPrice: num((info.price as Record<string, unknown> | undefined)?.price),
    };
    samples.push(sample);

    if (!quoteTokenPriceUsd && sample.quoteAddress) {
      quoteTokenAddress = sample.quoteAddress;
    }
  }

  console.log(`Usable samples (had a pool + token/info): ${samples.length}\n`);

  // Independently look up the quote token's own USD price via GMGN's
  // own token/info for that address — a semi-independent cross-check
  // (GMGN's own market view of that asset, not derived from any one
  // pool's reserve/value computation).
  if (quoteTokenAddress) {
    const quoteInfo = await fetchTokenInfo(quoteTokenAddress);
    quoteTokenPriceUsd = num((quoteInfo?.price as Record<string, unknown> | undefined)?.price);
    console.log(`Quote token (${quoteTokenAddress}) own GMGN price: ${quoteTokenPriceUsd ?? "unavailable"}\n`);
  }

  // ── Numeric comparisons ──
  console.log("=== Numeric comparisons: GMGN liquidity vs. base_reserve_value + quote_reserve_value ===\n");
  let comparisonCount = 0;
  for (const s of samples.slice(0, 15)) {
    if (s.liquidity == null) continue;
    const sumValue =
      s.baseReserveValue != null && s.quoteReserveValue != null
        ? s.baseReserveValue + s.quoteReserveValue
        : null;
    const impliedFromQuotePriceX2 =
      s.quoteReserve != null && quoteTokenPriceUsd != null ? 2 * s.quoteReserve * quoteTokenPriceUsd : null;

    console.log(`Token ${s.address} (${s.stage}, launchpad=pons)`);
    console.log(`  base_reserve=${s.baseReserve} quote_reserve=${s.quoteReserve}`);
    console.log(`  base_reserve_value=${s.baseReserveValue} quote_reserve_value=${s.quoteReserveValue}`);
    console.log(`  GMGN liquidity=${s.liquidity}`);
    if (sumValue != null) {
      const diff = Math.abs(s.liquidity - sumValue);
      const pct = sumValue !== 0 ? (diff / sumValue) * 100 : null;
      console.log(`  sum(base_value+quote_value)=${sumValue}  |diff|=${diff}  pct_diff=${pct?.toFixed(1)}%`);
    }
    if (impliedFromQuotePriceX2 != null) {
      const diff2 = Math.abs(s.liquidity - impliedFromQuotePriceX2);
      const pct2 = impliedFromQuotePriceX2 !== 0 ? (diff2 / impliedFromQuotePriceX2) * 100 : null;
      console.log(
        `  2x(quote_reserve * quote_own_price=${quoteTokenPriceUsd})=${impliedFromQuotePriceX2}  |diff|=${diff2}  pct_diff=${pct2?.toFixed(1)}%`
      );
    }
    console.log("");
    comparisonCount++;
  }
  console.log(`(${comparisonCount} comparison rows printed, capped at 15)\n`);

  // ── Independent on-chain cross-check for one sample ──
  const withPool = samples.find((s) => s.poolAddress);
  if (withPool?.poolAddress) {
    console.log(`=== On-chain cross-check for ${withPool.address} (pool ${withPool.poolAddress}) ===`);
    try {
      const client = getMainnetClient();
      const quoteBal = await client.readContract({
        address: withPool.quoteAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [withPool.poolAddress as `0x${string}`],
      });
      const quoteDecimals = await client.readContract({
        address: withPool.quoteAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
      });
      console.log(`  on-chain quote balanceOf(pool) = ${quoteBal.toString()} raw, ${Number(quoteBal) / 10 ** quoteDecimals} human`);
      console.log(`  GMGN quote_reserve reported    = ${withPool.quoteReserve}`);
    } catch (error) {
      console.log("  on-chain check failed (wrong network config for this sample, or RPC error):", error instanceof Error ? error.message : error);
    }
  }

  // ── Distribution over new_creation liquidity only (v1 scope) ──
  const liquidityValues = newCreation
    .map((item) => num((item as TrenchItem).liquidity))
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);

  console.log(`\n=== new_creation liquidity distribution (n=${liquidityValues.length}, raw GMGN trenches field, unit unresolved) ===`);
  if (liquidityValues.length > 0) {
    const pct = (p: number) => liquidityValues[Math.min(liquidityValues.length - 1, Math.floor((p / 100) * liquidityValues.length))];
    console.log(`  min=${liquidityValues[0]}`);
    console.log(`  p10=${pct(10)}`);
    console.log(`  p25=${pct(25)}`);
    console.log(`  median=${pct(50)}`);
    console.log(`  p75=${pct(75)}`);
    console.log(`  p90=${pct(90)}`);
    console.log(`  max=${liquidityValues[liquidityValues.length - 1]}`);
    for (const threshold of [100, 500, 1000, 2500, 5000, 10000]) {
      const count = liquidityValues.filter((v) => v < threshold).length;
      console.log(`  count < ${threshold}: ${count} / ${liquidityValues.length}`);
    }
  } else {
    console.log("  no usable liquidity values found in the new_creation sample");
  }
}

main().catch((e) => console.error("fatal", e));
