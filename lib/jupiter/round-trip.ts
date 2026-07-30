import { getSwapQuote, SOL_MINT, solToLamports } from "@/lib/jupiter/swap";

/**
 * Sell simulation (§9.6), done as a round trip rather than a lone sell quote.
 *
 * The signal that matters is **asymmetry**. A route in but no route out is
 * the shape of a honeypot: the buy lands and the position can never be
 * closed. No route in either direction is not evidence of anything, because
 * a mint seconds old is often not yet indexed by any router, and refusing on
 * that would refuse nearly every fresh candidate, which is how a safety gate
 * turns into an outage.
 *
 * Quoting rather than simulating a signed transaction is deliberate: a quote
 * already routes through real pool state and reports the impact of this
 * specific size, costs no signature, and cannot accidentally submit. It does
 * not catch a hook that fails only at execution, which is why the extension
 * gate exists upstream (lib/sniper/token-extensions.ts) and why §9.6's
 * caveat about the limits of simulation still stands.
 */

export type RoundTripResult =
  | { kind: "no-route-either-way" }
  | { kind: "cannot-sell" }
  | {
      kind: "ok";
      /** What the round trip costs, in percent of the SOL put in. Includes
       *  both legs' price impact and both legs' routing fees. */
      lossPct: number;
      /** Impact of the sell leg alone, in percent. */
      sellImpactPct: number;
    };

/**
 * Quotes SOL to the mint, then quotes the received amount straight back.
 *
 * `slippageBps` only shapes the quote's own threshold; the loss figure here
 * is computed from expected amounts, so it measures the pool rather than the
 * tolerance.
 */
export async function checkRoundTrip(params: {
  mint: string;
  sizeSol: number;
  slippageBps: number;
}): Promise<RoundTripResult> {
  const buy = await getSwapQuote({
    inputMint: SOL_MINT,
    outputMint: params.mint,
    amount: solToLamports(params.sizeSol),
    slippageBps: params.slippageBps,
  });
  if (!buy) return { kind: "no-route-either-way" };

  const tokensOut = BigInt(buy.outAmount);
  if (tokensOut <= BigInt(0)) return { kind: "no-route-either-way" };

  const sell = await getSwapQuote({
    inputMint: params.mint,
    outputMint: SOL_MINT,
    amount: tokensOut,
    slippageBps: params.slippageBps,
  });
  // Buyable but not sellable. This is the case worth refusing outright.
  if (!sell) return { kind: "cannot-sell" };

  const solIn = Number(buy.inAmount);
  const solBack = Number(sell.outAmount);
  if (!Number.isFinite(solIn) || solIn <= 0) return { kind: "no-route-either-way" };

  const lossPct = ((solIn - solBack) / solIn) * 100;
  const sellImpactPct = Math.abs(Number(sell.priceImpactPct) * 100) || 0;
  return { kind: "ok", lossPct, sellImpactPct };
}

/**
 * The refusal reasons a round trip produces, given a maximum tolerable
 * round-trip cost.
 *
 * Fixed threshold rather than an operator knob, for the same reason as the
 * extension gate: this is not risk appetite, it is whether an exit exists at
 * a survivable price. An operator raising it is agreeing to pay a toll that
 * already exceeds most of the edge they are trading for.
 */
export function roundTripRefusalReasons(
  result: RoundTripResult,
  maxLossPct: number
): string[] {
  switch (result.kind) {
    case "no-route-either-way":
      // Not a refusal on its own: a brand-new mint routes nowhere yet.
      return [];
    case "cannot-sell":
      return [
        "sell simulation failed: the position can be bought but not sold at any size",
      ];
    case "ok":
      return result.lossPct > maxLossPct
        ? [
            `sell simulation: a round trip at this size loses ${result.lossPct.toFixed(1)}%, over the ${maxLossPct}% limit`,
          ]
        : [];
  }
}
