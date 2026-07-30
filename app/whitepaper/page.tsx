import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { WhitepaperContent } from "@/components/whitepaper/whitepaper-content";
import { WhitepaperToc } from "@/components/whitepaper/whitepaper-toc";

export const metadata: Metadata = {
  title: "Whitepaper · Noah Engine",
  description:
    "A public fleet of autonomous trading agents on Solana: the tiered safety gate, shared verdict model, idempotent execution, and honest limits of stop-loss on an AMM.",
};

export default function WhitepaperPage() {
  return (
    <>
      <div className="bg-noise pointer-events-none fixed inset-0 opacity-[0.15]" />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-24 right-[15%] h-96 w-96 rounded-full bg-primary/10 blur-[130px]"
      />
      <SiteHeader />
      {/* No overflow-hidden here (unlike /deploy, /alpha): it would
          break position: sticky on WhitepaperToc below. The ambient-glow
          and noise decoration above are `fixed`, so they were never
          actually being clipped by it anyway. */}
      <main className="relative flex-1">
        <div className="relative mx-auto max-w-7xl px-6 py-8 sm:px-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4 pb-6">
            <div>
              <p className="text-primary text-[10px] tracking-widest uppercase sm:text-xs">
                Whitepaper
              </p>
              <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
                A public fleet,{" "}
                <em className="font-instrument font-normal italic text-foreground/60">
                  built to survive.
                </em>
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                v1.0-rc: the mechanisms, not the intentions. Fields marked
                ⟦FILL⟧ are values not yet measured, decided, or reviewed;
                see Appendix D.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-10">
            <WhitepaperToc />
            <div className="min-w-0 flex-1 overflow-hidden rounded-2xl bg-card px-6 py-8 sm:px-10 sm:py-10">
              <WhitepaperContent />
            </div>
          </div>
        </div>
      </main>
      <SiteFooter slim />
    </>
  );
}
