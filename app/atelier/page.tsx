import type { Metadata } from "next";

import { AtelierFleet } from "@/components/atelier/atelier-fleet";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Atelier · Noah Engine",
  description:
    "Every deployed agent, its performance, and its open positions: the fleet, in one place.",
};

export default function AtelierPage() {
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
                Atelier
              </p>
              <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
                Every agent,{" "}
                <em className="font-instrument font-normal italic text-foreground/60">
                  at work.
                </em>
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Every deployed automaton, its performance, and what it&apos;s
                holding right now.
              </p>
            </div>
          </div>

          <AtelierFleet />
        </div>
      </main>
      <SiteFooter slim />
    </>
  );
}
