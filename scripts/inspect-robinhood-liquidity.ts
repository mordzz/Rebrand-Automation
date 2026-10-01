/**
 * Read-only investigation script for Robinhood/GMGN liquidity semantics.
 *
 * Never signs a transaction, never requires a private key. Uses the
 * configured GMGN_API_KEY (server-side env var) and a read-only Robinhood
 * mainnet RPC client for on-chain cross-checks. Prints only public
 * on-chain data and public GMGN market data - no secrets are logged (the
 * API key itself is never printed). Uses GMGN + read-only Robinhood RPC
 * only - no external price API (CoinGecko/CoinMarketCap/etc.) dependency.
 *
 * Purpose: gather evidence for the still-open "is GMGN Robinhood
 * `liquidity` really USD, and is it a useful safety discriminator"
 * question. Does NOT change any runtime safety behavior.
 *
 * Run: npm run inspect:robinhood-liquidity
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { gmgnRequest } from "@/lib/gmgn/client";
import { createPublicClient, http, defineChain } from "viem";

// GMGN's Robinhood market data indexes MAINNET (chain id 4663) - the
// repo's configured PR03 RPC client defaults to testnet
// (NEXT_PUBLIC_ROBINHOOD_NETWORK), which returns no bytecode for any of
// these addresses (confirmed during the earlier Pons investigation).
// This script needs mainnet specifically, so it defines its own
// read-only mainnet client rather than reusing the network-configurable
// one.
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

/** Standard Type-7 quantile (the common "linear interpolation" method,
 * same one most stats packages default to) - NOT the earlier
 * `floor(p/100 * length)` implementation, which is not a standard
 * quantile and gives a misleading median for small/even-sized samples
 * (e.g. it never averages the two middle values for even n). */
function quantile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedAsc[0];
  const index = (n - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedAsc[lower];
  const weight = index - lower;
  return sortedAsc[lower] * (1 - weight) + sortedAsc[upper] * weight;
}

type Sample = {
  address: string;
  stage: string;
  poolAddress: string | null;
  quoteAddress: string | null; // normalized lowercase
  quoteSymbol: string | null;
  baseReserve: number | null;
  quoteReserve: number | null;
  baseReserveValue: number | null;
  quoteReserveValue: number | null;
  liquidity: number | null;
};

async function main() {
  console.log("=== Robinhood/GMGN liquidity investigation (read-only) ===\n");

  console.log("Fetching pons new_creation candidates...");
  const newCreation = await fetchTrenches("new_creation", 80);
  console.log(`  got ${newCreation.length} item(s)`);

  console.log("Fetching pons near_completion candidates (verification only - not enabled in Noah)...");
  const nearCompletion = await fetchTrenches("near_completion", 30);
  console.log(`  got ${nearCompletion.length} item(s)`);

  console.log("Fetching pons completed candidates (verification only - not enabled in Noah)...");
  const completed = await fetchTrenches("completed", 30);
  console.log(`  got ${completed.length} item(s)`);

  const allCandidates: { item: TrenchItem; stage: string }[] = [
    ...newCreation.map((item) => ({ item, stage: "new_creation" })),
    ...nearCompletion.map((item) => ({ item, stage: "near_completion" })),
    ...completed.map((item) => ({ item, stage: "completed" })),
  ];
  console.log(`\nTotal candidates fetched: ${allCandidates.length}\n`);

  const samples: Sample[] = [];

  for (const { item, stage } of allCandidates) {
    const address = item.address as string;
    const info = await fetchTokenInfo(address);
    if (!info) continue;
    const pool = info.pool as Record<string, unknown> | undefined;
    if (!pool) continue;

    samples.push({
      address,
      stage,
      poolAddress: (pool.pool_address as string)?.toLowerCase() ?? null,
      quoteAddress: (pool.quote_address as string)?.toLowerCase() ?? null,
      quoteSymbol: (pool.quote_symbol as string) ?? null,
      baseReserve: num(pool.base_reserve),
      quoteReserve: num(pool.quote_reserve),
      baseReserveValue: num(pool.base_reserve_value),
      quoteReserveValue: num(pool.quote_reserve_value),
      liquidity: num(pool.liquidity ?? info.liquidity),
    });
  }

  console.log(`Usable samples (had a pool + token/info): ${samples.length}\n`);

  // ── Per-quote-token price resolution: a Map<quoteAddress, usdPrice>,
  // populated by querying each UNIQUE quote address's own GMGN
  // token/info once (cached, not re-fetched per sample). Using one
  // sample's quote price for every comparison would only be valid if
  // every pool shares the same quote token - that assumption is now
  // verified explicitly, not assumed. ──
  const uniqueQuoteAddresses = [...new Set(samples.map((s) => s.quoteAddress).filter((a): a is string => a != null))];
  console.log(`Distinct quote token addresses across all samples: ${uniqueQuoteAddresses.length}`);

  const quotePriceByAddress = new Map<string, { price: number | null; symbol: string | null }>();
  for (const addr of uniqueQuoteAddresses) {
    const info = await fetchTokenInfo(addr);
    const price = num((info?.price as Record<string, unknown> | undefined)?.price);
    const symbol = (info?.symbol as string) ?? null;
    quotePriceByAddress.set(addr, { price, symbol });
    console.log(`  ${addr} (symbol=${symbol}) -> GMGN token/info price = ${price ?? "unavailable"}`);
  }
  console.log("");

  // ── Numeric comparisons, per-sample using ITS OWN quote token's price ──
  console.log("=== Numeric comparisons ===\n");
  console.log("Two relationships checked per sample:");
  console.log("  (a) base_reserve_value + quote_reserve_value  [documented USD fields, no documented arithmetic relationship to `liquidity`]");
  console.log("  (b) 2 x quote_reserve x quote-token GMGN price  [empirically observed relationship]\n");

  let comparisonCount = 0;
  let excludedNoQuotePrice = 0;
  const quoteAddressUsageCount = new Map<string, number>();

  for (const s of samples.slice(0, 20)) {
    if (s.liquidity == null) continue;
    if (!s.quoteAddress) continue;

    const quoteInfo = quotePriceByAddress.get(s.quoteAddress);
    if (!quoteInfo || quoteInfo.price == null) {
      excludedNoQuotePrice++;
      console.log(`Token ${s.address} (${s.stage}) - EXCLUDED from formula (b): quote token ${s.quoteAddress} has no GMGN price available.\n`);
      continue;
    }

    quoteAddressUsageCount.set(s.quoteAddress, (quoteAddressUsageCount.get(s.quoteAddress) ?? 0) + 1);

    const sumValue =
      s.baseReserveValue != null && s.quoteReserveValue != null ? s.baseReserveValue + s.quoteReserveValue : null;
    const impliedFromQuotePriceX2 = s.quoteReserve != null ? 2 * s.quoteReserve * quoteInfo.price : null;

    console.log(`Token ${s.address} (${s.stage}, launchpad=pons, quote=${s.quoteSymbol}/${s.quoteAddress})`);
    console.log(`  base_reserve=${s.baseReserve} quote_reserve=${s.quoteReserve}`);
    console.log(`  base_reserve_value=${s.baseReserveValue} quote_reserve_value=${s.quoteReserveValue}`);
    console.log(`  GMGN liquidity=${s.liquidity}`);
    if (sumValue != null) {
      const diff = Math.abs(s.liquidity - sumValue);
      const pct = sumValue !== 0 ? (diff / sumValue) * 100 : null;
      console.log(`  (a) sum(base_value+quote_value)=${sumValue}  |diff|=${diff}  pct_diff=${pct?.toFixed(1)}%`);
    }
    if (impliedFromQuotePriceX2 != null) {
      const diff2 = Math.abs(s.liquidity - impliedFromQuotePriceX2);
      const pct2 = impliedFromQuotePriceX2 !== 0 ? (diff2 / impliedFromQuotePriceX2) * 100 : null;
      console.log(
        `  (b) 2x(quote_reserve * quote_price[${s.quoteAddress}]=${quoteInfo.price})=${impliedFromQuotePriceX2}  |diff|=${diff2}  pct_diff=${pct2?.toFixed(1)}%`
      );
    }
    console.log("");
    comparisonCount++;
  }
  console.log(`(${comparisonCount} comparison rows printed, ${excludedNoQuotePrice} excluded for missing quote price, capped at 20)\n`);

  console.log("Quote-token usage across comparison samples:");
  for (const [addr, count] of quoteAddressUsageCount) {
    const info = quotePriceByAddress.get(addr);
    console.log(`  ${count}/${comparisonCount} comparison samples use ${addr} (symbol=${info?.symbol}, price=${info?.price})`);
  }
  console.log("");

  // ── Independent on-chain cross-check for one sample ──
  const withPool = samples.find((s) => s.poolAddress && s.quoteAddress);
  if (withPool?.poolAddress && withPool.quoteAddress) {
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
      console.log("  on-chain check failed:", error instanceof Error ? error.message : error);
    }
  }

  // ── Distribution over new_creation liquidity only (v1 scope) ──
  const liquidityValues = newCreation
    .map((item) => num((item as TrenchItem).liquidity))
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);

  console.log(
    `\n=== new_creation liquidity distribution (n=${liquidityValues.length}, unit = GMGN-documented/empirically-verified USD; quantile method = linear interpolation, index=(n-1)*p, Type-7) ===`
  );
  if (liquidityValues.length > 0) {
    console.log(`  min=${liquidityValues[0]}`);
    console.log(`  p10=${quantile(liquidityValues, 0.1)}`);
    console.log(`  p25=${quantile(liquidityValues, 0.25)}`);
    console.log(`  median=${quantile(liquidityValues, 0.5)}`);
    console.log(`  p75=${quantile(liquidityValues, 0.75)}`);
    console.log(`  p90=${quantile(liquidityValues, 0.9)}`);
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
