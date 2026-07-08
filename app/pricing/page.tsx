import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Ticker } from "@/components/ticker";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
  title: "Pricing — The Fable",
  description:
    "The tariffs of The Fable: plans for scouts, operators, and syndicates trading the Solana trenches with automated strategies.",
};

const TIERS = [
  {
    name: "The Scout",
    price: "0.5 SOL",
    cadence: "per month",
    blurb: "For the trencher testing the waters with a modest kit.",
    featured: false,
    features: [
      "The Clockwork automaton",
      "The Sentry on 3 positions",
      "1 wallet connected",
      "Telegram dispatches",
      "Standard priority fees",
    ],
    cta: "Enlist as a Scout",
  },
  {
    name: "The Operator",
    price: "2 SOL",
    cadence: "per month",
    blurb: "The full armoury for the working trencher.",
    featured: true,
    features: [
      "All four house automatons",
      "The Sentry on unlimited positions",
      "The Shadow on up to 10 wallets",
      "3 wallets connected",
      "Tuned priority fees & retries",
      "Rug-response emergency exits",
    ],
    cta: "Enlist as an Operator",
  },
  {
    name: "The Syndicate",
    price: "8 SOL",
    cadence: "per month",
    blurb: "For desks and cabals running serious campaigns.",
    featured: false,
    features: [
      "Everything in The Operator",
      "The Shadow on up to 25 wallets",
      "10 wallets connected",
      "Dedicated RPC lane",
      "Webhook & API access",
      "A direct line to the house",
    ],
    cta: "Convene a Syndicate",
  },
];

const FAQS = [
  {
    question: "Does the house ever hold my keys?",
    answer:
      "Never. Keys are generated and encrypted on your side of the counter, and every automaton signs with them locally. The house sees your instructions, not your keys — custody remains entirely yours.",
  },
  {
    question: "What happens during a rug pull?",
    answer:
      "The Sentry watches pool liquidity in real time. When it detects a drain in progress, it files an emergency exit with elevated priority fees immediately — no confirmation dialog, no hesitation. It will not always win the race, but it runs it faster than any human.",
  },
  {
    question: "Can I cancel my enlistment?",
    answer:
      "At any time, effective the end of the paid month. Your automatons finish their standing orders, deliver a final ledger, and stand down. No exit interviews, no guilt.",
  },
  {
    question: "Which venues do the automatons trade?",
    answer:
      "Pump.fun, Raydium, and Meteora at present, with routing through Jupiter where it improves the fill. New venues are added once they have proven themselves worthy of the house's attention.",
  },
  {
    question: "Is this financial advice?",
    answer:
      "It is not. The Fable supplies machinery, not judgement. The trenches are muddy and the mud is deep — size your positions as if the machine might lose the race, because some days it will.",
  },
];

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="border-b bg-secondary/60">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <Reveal>
              <Badge variant="secondary" className="rounded-full bg-background px-3 py-1">
                The Tariff Board · Prices in SOL
              </Badge>
              <h1 className="mx-auto mt-6 max-w-3xl font-display text-5xl font-medium text-balance sm:text-6xl">
                Honest Tariffs, Plainly Posted
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
                No hidden levies, no fine print in invisible ink. Choose your
                station and the machinery is yours.
              </p>
            </Reveal>
          </div>
        </section>

        <Ticker />

        {/* Tiers */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid items-stretch gap-5 lg:grid-cols-3">
            {TIERS.map((tier, i) => (
              <Reveal key={tier.name} delay={i * 130} className="h-full">
                <div
                  className={`relative h-full rounded-2xl border bg-card p-8 transition-all duration-300 hover:-translate-y-1 ${
                    tier.featured ? "border-accent" : "hover:border-accent/40"
                  }`}
                >
                  {tier.featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                      Most popular
                    </span>
                  )}
                  <p className="text-xs font-semibold tracking-[0.2em] uppercase text-accent">
                    Station {i + 1}
                  </p>
                  <h2 className="mt-2 font-display text-3xl font-medium">
                    {tier.name}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {tier.blurb}
                  </p>
                  <p className="mt-6 flex items-baseline gap-2">
                    <span className="font-display text-4xl font-medium">
                      {tier.price}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tier.cadence}
                    </span>
                  </p>
                  <Separator className="my-6" />
                  <ul className="space-y-3 text-sm">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Button
                    nativeButton={false}
                    render={<Link href="/strategies" />}
                    variant={tier.featured ? "default" : "outline"}
                    className="mt-8 h-10 w-full"
                  >
                    {tier.cta}
                  </Button>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <p className="mt-10 text-center text-sm text-muted-foreground">
              Settled in SOL · No lock-in · Cancel whenever you please.
            </p>
          </Reveal>
        </section>

        {/* FAQ */}
        <section className="border-t bg-secondary/60">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
            <Reveal className="text-center">
              <p className="text-xs font-semibold tracking-[0.2em] uppercase text-accent">
                Enquiries at the Counter
              </p>
              <h2 className="mt-3 font-display text-4xl font-medium">
                Frequently Posed Questions
              </h2>
            </Reveal>
            <Reveal delay={150}>
              <Accordion className="mt-12 rounded-2xl border bg-card px-2">
                {FAQS.map((faq) => (
                  <AccordionItem key={faq.question} className="px-4">
                    <AccordionTrigger className="py-5 font-display text-lg font-medium hover:text-accent hover:no-underline">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="pb-5 text-base leading-relaxed text-muted-foreground">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Reveal>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-accent text-accent-foreground">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
            <Reveal>
              <h2 className="font-display text-4xl font-medium text-balance sm:text-5xl">
                Still Undecided? Read the Manual.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-accent-foreground/85">
                Study each automaton&apos;s specification sheet before you put
                it to work in the trenches.
              </p>
              <Button
                size="lg"
                nativeButton={false}
                render={<Link href="/strategies" />}
                className="mt-8 h-11 bg-accent-foreground px-8 text-accent hover:bg-accent-foreground/90"
              >
                Explore strategies
              </Button>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
