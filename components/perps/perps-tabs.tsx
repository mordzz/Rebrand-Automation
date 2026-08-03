"use client";

import { useState } from "react";

import { CreateTokenForm } from "@/components/perps/create-token-form";
import { FeeFlowDiagram } from "@/components/perps/fee-flow-diagram";
import { HowItWorks } from "@/components/perps/how-it-works";
import { LivePositions } from "@/components/perps/live-positions";
import { MarketTicker } from "@/components/perps/market-ticker";
import { PerpsHero } from "@/components/perps/perps-hero";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { value: "tokens", label: "Launched Tokens" },
  { value: "launch", label: "Launch" },
  { value: "fees", label: "Route Fees" },
] as const;

/* `flex-none` because TabsTrigger's base class is `flex-1` — without it
   the three labels stretch to fill the row and end up marooned at
   opposite edges of the viewport, reading as three separate things
   rather than one control. Active state is `data-active` (base-ui), not
   `data-[state=active]`; the underline itself is the primitive's own
   `::after` indicator, so there's no border to style here. */
const TRIGGER_CLASS =
  "flex-none rounded-none px-1 py-3 font-mono text-[11px] tracking-[0.18em] uppercase text-muted-foreground transition-colors hover:text-foreground/80 data-active:text-foreground";

export function PerpsTabs() {
  // Controlled so the empty-state CTA on the tokens tab can send someone
  // straight to the launch form — an uncontrolled Tabs has no way to do
  // that from a child.
  const [tab, setTab] = useState<string>("tokens");

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(String(v))}
      className="w-full gap-0"
    >
      {/* Live oracle prices, full-bleed above the tab bar — real Pyth
          data, visible whichever tab is open. */}
      <MarketTicker />

      <div className="border-b border-white/6">
        <div className="mx-auto max-w-6xl px-6 sm:px-10">
          <TabsList
            variant="line"
            className="h-auto justify-start gap-7 overflow-x-auto border-b-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className={TRIGGER_CLASS}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-6 pt-10 sm:px-10">
        <TabsContent value="tokens" className="mt-0 outline-none">
          <LivePositions onLaunchClick={() => setTab("launch")} />
        </TabsContent>

        {/* One column for the whole launch flow. Previously the hero,
            the form and the how-it-works grid each set their own width
            and centering, so the three sections started at three
            different left edges down the same page. */}
        <TabsContent value="launch" className="mt-0 outline-none">
          <div className="mx-auto max-w-3xl pb-20">
            <PerpsHero />
            <CreateTokenForm />
            <HowItWorks />
          </div>
        </TabsContent>

        <TabsContent value="fees" className="mt-0 outline-none">
          <div className="mx-auto max-w-4xl">
            <FeeFlowDiagram />
          </div>
        </TabsContent>
      </div>
    </Tabs>
  );
}
