import type { Metadata } from "next";

import { PerpsTabs } from "@/components/perps/perps-tabs";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Noahpad Perpetuals",
  description:
    "Launch tokens backed by real perpetual futures. Trading fees auto compound into collateral, buy back and burn tokens, and strengthen governance all autonomous.",
};

export default function PerpsPage() {
  return (
    <>
      <div className="bg-noise pointer-events-none fixed inset-0 opacity-[0.15]" />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-24 right-[15%] h-96 w-96 rounded-full bg-primary/10 blur-[130px]"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -bottom-32 left-[10%] h-72 w-72 rounded-full bg-primary/5 blur-[120px]"
      />
      <SiteHeader />
      <main className="relative flex-1 overflow-hidden">
        <PerpsTabs />
      </main>
      <SiteFooter slim />
    </>
  );
}
