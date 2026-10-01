import { erc20Abi, isAddress } from "viem";

import { getRobinhoodPublicClient } from "@/lib/chain/rpc";

/**
 * Market cap for a position, so a price can be read by a human.
 *
 * A per-token price on a fresh launch is a tiny number that tells an
 * operator nothing about whether the entry was early or late. Market cap is
 * the unit this market actually thinks in ("entered at 40k, it's at 80k"),
 * and it is directly comparable across tokens with different supplies.
 *
 * Robinhood positions store prices in USD per whole token, so
 * cap = price x ERC-20 supply, with supply read on-chain rather than
 * assumed. When supply can't be read, a "-" is more honest than a guess.
 */

export type TokenSupply = { supply: bigint; decimals: number };

export type PositionMarketCaps = {
  entryUsd: number | null;
  currentUsd: number | null;
};

/* Supply is effectively fixed for a renounced-owner token, so it can be
   cached hard. Bounded so a long-running process cannot grow it without
   limit. */
const SUPPLY_CACHE_MAX = 2000;
const erc20SupplyCache = new Map<string, TokenSupply | null>();

/** ERC-20 totalSupply + decimals on Robinhood Chain (cached, bounded). */
async function getErc20Supply(token: string): Promise<TokenSupply | null> {
  const cached = erc20SupplyCache.get(token);
  if (cached !== undefined) return cached;
  let result: TokenSupply | null = null;
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

function usdCap(priceUsd: number, supply: TokenSupply): number | null {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  const wholeTokens = Number(supply.supply) / 10 ** supply.decimals;
  if (!Number.isFinite(wholeTokens) || wholeTokens <= 0) return null;
  return priceUsd * wholeTokens;
}

/**
 * Entry and current market cap for a batch of positions. One supply read
 * per distinct token. Returns nulls rather than throwing when a figure
 * cannot be established, so a display never invents one.
 */
export async function marketCapsForPositions(
  positions: { tokenAddress: string; entryPrice: string | null; lastPrice: string | null }[]
): Promise<Map<string, PositionMarketCaps>> {
  const out = new Map<string, PositionMarketCaps>();
  if (positions.length === 0) return out;

  const supplies = new Map(
    await Promise.all(
      [...new Set(positions.map((p) => p.tokenAddress))].map(async (t) => [t, await getErc20Supply(t)] as const),
    ),
  );
  for (const p of positions) {
    const supply = supplies.get(p.tokenAddress) ?? null;
    const cap = (price: string | null) => (price != null && supply ? usdCap(Number(price), supply) : null);
    out.set(p.tokenAddress, { entryUsd: cap(p.entryPrice), currentUsd: cap(p.lastPrice) });
  }
  return out;
}

/** Compact market cap for display: $41.2K, $1.8M. */
export function formatMarketCap(usd: number | null): string {
  if (usd == null || !Number.isFinite(usd)) return "-";
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}
