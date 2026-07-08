import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Ticker } from "@/components/ticker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = {
  title: "Strategies — The Fable",
  description:
    "The complete field manual of The Fable automatons: sniping, copy-trading, risk sentries, and clockwork accumulation on Solana.",
};

const STRATEGIES = [
  {
    id: "sniper",
    tab: "The Sniper",
    numeral: "No. 1",
    title: "The Sniper",
    tagline: "First through the door at every launch.",
    description:
      "The Sniper watches the mempool and launchpads the way a hawk watches a field. The moment liquidity lands on a new pool, it files your order with tuned priority fees — typically inside the first block or two. Honeypot checks, mint-authority inspection, and liquidity-lock verification are performed on the way in, so you are not first through the door of a burning building.",
    specs: [
      ["Reaction time", "Sub-second, first blocks"],
      ["Venues", "Pump.fun, Raydium, Meteora"],
      ["Safety checks", "Honeypot, mint authority, LP lock"],
      ["Sizing", "Fixed or % of bankroll"],
      ["Exit", "Auto TP/SL or hand-off to the Sentry"],
    ],
    fieldNote:
      "Speed is a tool, not a strategy. The Sniper is best deployed with strict sizing and a standing exit order.",
  },
  {
    id: "shadow",
    tab: "The Shadow",
    numeral: "No. 2",
    title: "The Shadow",
    tagline: "Mirror the finest wallets in the trenches.",
    description:
      "Provide the addresses of trenchers whose judgement you respect, and the Shadow follows their every move — scaled to your own purse. It enters when they enter and, crucially, leaves when they leave. Per-wallet allocation, token blacklists, and a maximum-concurrent-positions rule keep the mimicry from becoming mischief.",
    specs: [
      ["Wallets followed", "Up to 25 simultaneously"],
      ["Mirror latency", "Same block where possible"],
      ["Sizing", "Proportional or fixed per trade"],
      ["Filters", "Token blacklist, min. liquidity"],
      ["Exit", "Mirrors the leader, or your own rules"],
    ],
    fieldNote:
      "A wallet with a fine month may have a dreadful quarter. Shadow several, and let no single leader command your whole bankroll.",
  },
  {
    id: "sentry",
    tab: "The Sentry",
    numeral: "No. 3",
    title: "The Sentry",
    tagline: "Stands guard over every open position.",
    description:
      "The Sentry is the house risk engine. It watches every open position against your stop-loss, take-profit, and trailing rules, and executes the moment a line is crossed — even at four in the morning, even during a rug in progress. Liquidity-drain detection can trigger an emergency exit long before a human would have noticed anything amiss.",
    specs: [
      ["Order types", "Stop-loss, take-profit, trailing"],
      ["Rug response", "Liquidity-drain emergency exit"],
      ["Laddered exits", "Up to 5 tranches per position"],
      ["Coverage", "Every position, every venue"],
      ["Dispatches", "Telegram & webhook alerts"],
    ],
    fieldNote:
      "The trencher who sets a stop-loss and honours it will still be trading next season. The Sentry exists to remove the temptation to negotiate.",
  },
  {
    id: "clockwork",
    tab: "The Clockwork",
    numeral: "No. 4",
    title: "The Clockwork",
    tagline: "Punctual accumulation, free of emotion.",
    description:
      "For instruments you intend to hold beyond the week, the Clockwork buys on a schedule — hourly, daily, or on dips of your chosen depth. It splits orders to soften price impact and records every purchase in a tidy ledger. No euphoria at the top, no despair at the bottom; merely arithmetic, performed on time.",
    specs: [
      ["Cadence", "Hourly, daily, weekly, or dip-triggered"],
      ["Dip trigger", "Buy on -X% from local high"],
      ["Order splitting", "TWAP-style tranches"],
      ["Ledger", "Full history, exportable"],
      ["Pause rules", "Halt on volatility or drawdown"],
    ],
    fieldNote:
      "The Clockwork is the least glamorous automaton in the house, and over a long campaign, frequently the most profitable.",
  },
];

const DOCTRINE = [
  "Never deploy the whole bankroll into a single trench.",
  "Every position carries a standing exit order, without exception.",
  "The machine executes the plan; it does not improvise one.",
  "Keys remain with the client. The house never takes custody.",
];

export default function StrategiesPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="border-b bg-secondary/60">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <Reveal>
              <Badge variant="secondary" className="rounded-full bg-background px-3 py-1">
                The Field Manual · Vol. 1
              </Badge>
              <h1 className="mx-auto mt-6 max-w-3xl font-display text-5xl font-medium text-balance sm:text-6xl">
                Strategies of the House
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
                Four automatons, each with its own temperament and trade. Study
                their specifications before sending them into the trenches.
              </p>
            </Reveal>
          </div>
        </section>

        <Ticker />

        {/* Strategy tabs */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <Reveal>
            <Tabs defaultValue="sniper" className="gap-10">
              <TabsList className="mx-auto h-auto w-full max-w-xl flex-wrap rounded-full p-1">
                {STRATEGIES.map((s) => (
                  <TabsTrigger
                    key={s.id}
                    value={s.id}
                    className="rounded-full px-4 py-1.5"
                  >
                    {s.tab}
                  </TabsTrigger>
                ))}
              </TabsList>

              {STRATEGIES.map((s) => (
                <TabsContent key={s.id} value={s.id}>
                  <div className="rounded-2xl border bg-card p-8 sm:p-12">
                    <div className="grid gap-10 lg:grid-cols-5">
                      <div className="lg:col-span-3">
                        <p className="text-xs font-semibold tracking-[0.2em] uppercase text-accent">
                          {s.numeral} — House Automaton
                        </p>
                        <h2 className="mt-3 font-display text-4xl font-medium">
                          {s.title}
                        </h2>
                        <p className="mt-2 text-lg text-muted-foreground">
                          {s.tagline}
                        </p>
                        <Separator className="my-6" />
                        <p className="text-base leading-relaxed">
                          {s.description}
                        </p>
                        <div className="mt-8 rounded-lg border-l-2 border-accent bg-muted/60 p-5">
                          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-accent">
                            Field Note
                          </p>
                          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {s.fieldNote}
                          </p>
                        </div>
                      </div>

                      <div className="lg:col-span-2">
                        <div className="overflow-hidden rounded-xl border bg-background">
                          <p className="border-b bg-muted/60 px-5 py-3 text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
                            Specification Sheet
                          </p>
                          <dl>
                            {s.specs.map(([term, detail]) => (
                              <div
                                key={term}
                                className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-3.5 last:border-b-0"
                              >
                                <dt className="text-xs tracking-wide uppercase text-muted-foreground">
                                  {term}
                                </dt>
                                <dd className="text-right text-sm font-medium">
                                  {detail}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                        <Button
                          nativeButton={false}
                          render={<Link href="/pricing" />}
                          className="mt-6 h-10 w-full"
                        >
                          Commission {s.title}
                        </Button>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </Reveal>
        </section>

        {/* Doctrine */}
        <section className="bg-primary text-primary-foreground">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <Reveal className="text-center">
              <p className="text-xs font-semibold tracking-[0.2em] uppercase text-accent">
                The House Doctrine
              </p>
              <h2 className="mt-3 font-display text-4xl font-medium">
                Rules We Do Not Break
              </h2>
            </Reveal>
            <ol className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
              {DOCTRINE.map((rule, i) => (
                <Reveal
                  key={rule}
                  as="li"
                  delay={i * 120}
                  className="flex items-start gap-4 rounded-xl border border-primary-foreground/15 p-5"
                >
                  <span className="font-display text-2xl font-medium text-accent">
                    {i + 1}
                  </span>
                  <p className="pt-1 text-sm leading-relaxed text-primary-foreground/85">
                    {rule}
                  </p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
