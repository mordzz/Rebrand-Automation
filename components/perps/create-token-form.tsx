"use client";

import { PERPS_MIGRATION_MESSAGE } from "@/lib/perps/program";

/**
 * Perpspad token launch form - paused (PR09A).
 *
 * The launch flow signed a Solana `register_token` transaction through a
 * Solana wallet. That runtime is retired, and whether a Robinhood Chain
 * launch product exists is UNRESOLVED (the PR13 Perpspad decision (git history)). This surface
 * states plainly that launches are unavailable rather than offering a form
 * that cannot complete.
 */
export function CreateTokenForm() {
  return (
    <section className="relative mt-8 rounded-2xl border border-white/8 bg-black/40 p-8 backdrop-blur-xl">
      <div className="mx-auto max-w-md text-center">
        <h3 className="mb-2 text-lg font-semibold text-foreground">Launches paused</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{PERPS_MIGRATION_MESSAGE}</p>
      </div>
    </section>
  );
}
