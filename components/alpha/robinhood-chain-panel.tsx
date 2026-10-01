import { Lock } from "lucide-react";

/** Robinhood Chain (Arbitrum Orbit L2, chain 4663, launched July 2026) has
 * no permissionless new-token stream like pump.fun - Stock Tokens are a
 * fixed set pegged 1:1 to real equities, so "runner" there means "biggest
 * mover," not "new listing." That needs historical price data, which the
 * free public RPC doesn't serve - a paid provider (QuickNode/Chainstack/
 * Dwellir/NodeFlare) is required. Deliberately not wired up with fake
 * data until that's connected. */
export function RobinhoodChainPanel() {
  return (
    <div className="overflow-hidden rounded-2xl bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Robinhood Chain · Stock Tokens
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Biggest movers among tokenized stocks &amp; ETFs.
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[0.7rem] font-medium tracking-[0.15em] uppercase text-muted-foreground">
          <Lock className="size-3" />
          Not connected
        </span>
      </div>
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        Robinhood Chain&apos;s free public RPC doesn&apos;t serve the
        historical price data a mover screener needs. Connect a paid RPC
        provider (QuickNode, Chainstack, Dwellir, or NodeFlare) to light this
        section up.
      </div>
    </div>
  );
}
