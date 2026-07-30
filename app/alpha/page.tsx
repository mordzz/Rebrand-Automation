import type { Metadata } from "next";

import { AlphaTable } from "@/components/alpha/alpha-table";
import { RobinhoodChainPanel } from "@/components/alpha/robinhood-chain-panel";
import { SmartMoneyPanel } from "@/components/alpha/smart-money-panel";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Alpha · Noah Engine",
  description:
    "Fresh mints the engine's own entry criteria are watching, across every chain it trades.",
};

export default function AlphaPage() {
  return (
    <>
      <div className="bg-noise pointer-events-none fixed inset-0 opacity-[0.15]" />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-24 right-[15%] h-96 w-96 rounded-full bg-primary/10 blur-[130px]"
      />
      <SiteHeader />
      <main className="relative flex-1 overflow-hidden">
        <div className="relative mx-auto max-w-7xl px-6 py-8 sm:px-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4 pb-6">
            <div>
              <p className="text-primary text-[10px] tracking-widest uppercase sm:text-xs">
                Alpha
              </p>
              <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
                What the engine{" "}
                <em className="font-instrument font-normal italic text-foreground/60">
                  is watching.
                </em>
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Every candidate below already passed the same entry criteria
                the Raven trades on: no rumor, no vibes, just the checks.
              </p>
            </div>
          </div>

          {/* Table full width and stacked, not side-by-side: it's a real
              table now (six columns), and squeezing it into half the page
              forced a horizontal scrollbar at every desktop width. The
              Robinhood panel is a status note, so it reads fine below. */}
          <div className="flex flex-col gap-5">
            <AlphaTable />
            <SmartMoneyPanel />
            <RobinhoodChainPanel />
          </div>
        </div>
      </main>
      <SiteFooter slim />
    </>
  );
}
