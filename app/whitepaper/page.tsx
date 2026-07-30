import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { WhitepaperContent } from "@/components/whitepaper/whitepaper-content";
import { WhitepaperToc } from "@/components/whitepaper/whitepaper-toc";
import { getWhitepaperToc } from "@/lib/whitepaper";

export const metadata: Metadata = {
  title: "Whitepaper · Noah Engine",
  description:
    "A public fleet of autonomous trading agents on Solana: the tiered safety gate, shared verdict model, idempotent execution, and honest limits of stop-loss on an AMM.",
};

export default function WhitepaperPage() {
  const tocEntries = getWhitepaperToc()
    .filter((entry) => entry.level === 2)
    .map(({ id, text }) => ({ id, text }));

  return (
    <>
      <div className="bg-noise pointer-events-none fixed inset-0 opacity-[0.15]" />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-24 right-[15%] h-96 w-96 rounded-full bg-primary/10 blur-[130px]"
      />
      {/* The header is a floating pill on a transparent page, so on a
          text-dense document the body visibly scrolled through it. A short
          top scrim gives the pill something to sit on without turning it
          into a solid bar. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-40 h-24 bg-gradient-to-b from-background via-background/85 to-transparent"
      />
      <SiteHeader />
      {/* No overflow-hidden here (unlike /deploy, /alpha): it would
          break position: sticky on WhitepaperToc below. The ambient-glow
          and noise decoration above are `fixed`, so they were never
          actually being clipped by it anyway. */}
      <main className="relative flex-1">
        <div className="relative mx-auto max-w-[70rem] px-5 py-8 sm:px-8">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-6 border-b border-white/10 pb-8">
            <div className="min-w-0">
              <p className="text-primary text-[10px] tracking-widest uppercase sm:text-xs">
                Whitepaper
              </p>
              <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
                A public fleet,{" "}
                <em className="font-instrument font-normal italic text-foreground/60">
                  built to survive.
                </em>
              </h1>
              <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
                v1.0-rc: the mechanisms, not the intentions. Fields marked
                ⟦FILL⟧ are values not yet measured, decided, or reviewed;
                see Appendix D.
              </p>
            </div>
            <dl className="flex shrink-0 gap-8 text-xs">
              <div>
                <dt className="text-[0.65rem] tracking-[0.15em] text-muted-foreground uppercase">
                  Sections
                </dt>
                <dd className="mt-1.5 text-lg font-medium tabular-nums">
                  {tocEntries.length}
                </dd>
              </div>
              <div>
                <dt className="text-[0.65rem] tracking-[0.15em] text-muted-foreground uppercase">
                  Version
                </dt>
                <dd className="mt-1.5 text-lg font-medium">v1.1</dd>
              </div>
            </dl>
          </div>

          <div className="flex items-start gap-12">
            <WhitepaperToc entries={tocEntries} />
            {/* No overflow-hidden: a table wider than the column needs to
                scroll inside its own wrapper, and clipping it here severed
                the overflow instead. */}
            <div className="min-w-0 flex-1 rounded-2xl bg-card px-5 py-8 sm:px-9 sm:py-12">
              <WhitepaperContent />
            </div>
          </div>
        </div>
      </main>
      <SiteFooter slim />
    </>
  );
}
