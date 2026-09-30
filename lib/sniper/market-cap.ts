import { erc20Abi, isAddress } from "viem";

import { getRobinhoodPublicClient } from "@/lib/chain/rpc";
import { assertSolanaAddress, solanaRpc } from "@/lib/solana/json-rpc";
import { getSolUsdPrice } from "@/lib/sniper/sol-price";

/**
 * Market cap for a position, so a price can be read by a human.
 *
 * A per-token price on a memecoin is a number like 5.76e-8 SOL, which tells
 * an operator nothing about whether the entry was early or late. Market cap
 * is the unit this market actually thinks in ("entered at 40k, it's at 80k"),
 * and it is directly comparable across tokens with different supplies.
 *
 * Supply comes from the mint account rather than an assumed 1B, because
 * "pump.fun mints are always 1B" is only true until it isn't, and a wrong
 * supply silently scales every figure shown to the operator.
 */

/** Mint layout, same account this project already parses for authorities:
 *  offset 36 supply u64 LE, offset 44 decimals u8. */
const SUPPLY_OFFSET = 36;
const DECIMALS_OFFSET = 44;

export type MintSupply = { supply: bigint; decimals: number };

/* Supply is fixed for the life of a mint whose mint authority is renounced,
   which is a requirement to enter at all, so this can be cached hard. Bounded
   so a long-running process cannot grow it without limit. */
const supplyCache = new Map<string, MintSupply | null>();
const SUPPLY_CACHE_MAX = 2000;

export async function getMintSupply(
  mint: string,
  rpcUrl?: string | null
): Promise<MintSupply | null> {
  const cached = supplyCache.get(mint);
  if (cached !== undefined) return cached;

  let result: MintSupply | null = null;
  try {
    const { value } = await solanaRpc<{ value: { data: [string, string] } | null }>(
      "getAccountInfo",
      [assertSolanaAddress(mint), { encoding: "base64" }],
      rpcUrl
    );
    if (value) {
      const bytes = Buffer.from(value.data[0], "base64");
      if (bytes.length >= 82) {
        result = {
          supply: bytes.readBigUInt64LE(SUPPLY_OFFSET),
          decimals: bytes[DECIMALS_OFFSET],
        };
      }
    }
  } catch {
    result = null;
  }

  if (supplyCache.size >= SUPPLY_CACHE_MAX) supplyCache.clear();
  supplyCache.set(mint, result);
  return result;
}

/**
 * Converts a per-token price in SOL into a USD market cap.
 *
 * `priceSol` is SOL per whole token, the same unit entry and exit prices are
 * stored in, so supply has to be scaled out of base units first.
 */
export function marketCapUsd(
  priceSol: number,
  supply: MintSupply,
  solUsd: number
): number | null {
  if (!Number.isFinite(priceSol) || priceSol <= 0) return null;
  if (!Number.isFinite(solUsd) || solUsd <= 0) return null;
  const wholeTokens = Number(supply.supply) / 10 ** supply.decimals;
  if (!Number.isFinite(wholeTokens) || wholeTokens <= 0) return null;
  return priceSol * wholeTokens * solUsd;
}

export type PositionMarketCaps = {
  entryUsd: number | null;
  currentUsd: number | null;
};

/**
 * Entry and current market cap for a batch of positions.
 *
 * Batched because a fleet view renders many positions at once and they
 * frequently share mints: one supply read per distinct mint, one SOL price
 * for the whole batch. Returns nulls rather than throwing when a figure
 * cannot be established, so a display never invents one.
 */
export async function marketCapsForPositions(
  positions: { token: string; entryPrice: string | null; lastPrice: string | null; chain?: string | null }[]
): Promise<Map<string, PositionMarketCaps>> {
  const out = new Map<string, PositionMarketCaps>();
  if (positions.length === 0) return out;

  // Robinhood rows (PR16): prices are already USD per whole token (PR07),
  // so cap = price × ERC-20 supply. No SOL conversion involved.
  const robinhood = positions.filter((p) => p.chain === "robinhood");
  const robinhoodSupplies = new Map(
    await Promise.all(
      [...new Set(robinhood.map((p) => p.token))].map(async (t) => [t, await getErc20Supply(t)] as const),
    ),
  );
  for (const p of robinhood) {
    const supply = robinhoodSupplies.get(p.token) ?? null;
    const cap = (price: string | null) =>
      price != null && supply ? usdCap(Number(price), supply) : null;
    out.set(p.token, { entryUsd: cap(p.entryPrice), currentUsd: cap(p.lastPrice) });
  }

  // Historical Solana rows keep the Solana mint/SOL-price path.
  positions = positions.filter((p) => p.chain !== "robinhood");
  if (positions.length === 0) return out;

  const mints = [...new Set(positions.map((p) => p.token))];
  const [solUsd, supplies] = await Promise.all([
    getSolUsdPrice(),
    Promise.all(mints.map(async (m) => [m, await getMintSupply(m)] as const)),
  ]);
  const supplyByMint = new Map(supplies);

  for (const p of positions) {
    const supply = supplyByMint.get(p.token);
    if (!supply || solUsd == null) {
      out.set(p.token, { entryUsd: null, currentUsd: null });
      continue;
    }
    out.set(p.token, {
      entryUsd:
        p.entryPrice != null ? marketCapUsd(Number(p.entryPrice), supply, solUsd) : null,
      currentUsd:
        p.lastPrice != null ? marketCapUsd(Number(p.lastPrice), supply, solUsd) : null,
    });
  }
  return out;
}

const erc20SupplyCache = new Map<string, MintSupply | null>();

/** ERC-20 totalSupply + decimals on Robinhood Chain (cached, bounded). */
async function getErc20Supply(token: string): Promise<MintSupply | null> {
  const cached = erc20SupplyCache.get(token);
  if (cached !== undefined) return cached;
  let result: MintSupply | null = null;
  if (isAddress(token)) {
    try {
      const client = getRobinhoodPublicClient();
      const [supply, decimals] = await Promise.all([
        client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
        client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      ]);
      result = { supply, decimals };
    } catch {
      result = null;
    }
  }
  if (erc20SupplyCache.size >= SUPPLY_CACHE_MAX) erc20SupplyCache.clear();
  erc20SupplyCache.set(token, result);
  return result;
}

function usdCap(priceUsd: number, supply: MintSupply): number | null {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  const wholeTokens = Number(supply.supply) / 10 ** supply.decimals;
  if (!Number.isFinite(wholeTokens) || wholeTokens <= 0) return null;
  return priceUsd * wholeTokens;
}

/** Compact market cap for display: $41.2K, $1.8M. */
export function formatMarketCap(usd: number | null): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}
