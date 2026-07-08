import { ArrowRight, Clock3, Crosshair, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";

import { Reveal } from "@/components/reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Ticker } from "@/components/ticker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SERVICES = [
  {
    icon: Crosshair,
    numeral: "01",
    title: "The Sniper",
    description:
      "New pools spotted and entered within the very first blocks. Your order arrives before the crowd has finished reading the ticker.",
  },
  {
    icon: Users,
    numeral: "02",
    title: "The Shadow",
    description:
      "Follow the wallets of proven trenchers, mirrored trade for trade, with your own sizing and your own exits. Discreet, as all good shadows are.",
  },
  {
    icon: ShieldCheck,
    numeral: "03",
    title: "The Sentry",
    description:
      "Stop-losses and take-profits that stand guard through the night. When the chart turns rude, the Sentry shows it the door.",
  },
  {
    icon: Clock3,
    numeral: "04",
    title: "The Clockwork",
    description:
      "Scheduled entries on the instruments you believe in. Punctual accumulation, ladder by ladder, without a single emotional purchase.",
  },
];

const STEPS = [
  {
    numeral: "01",
    title: "Present Your Credentials",
    description:
      "Connect a burner wallet or generate one in-house. Your keys stay encrypted on your side of the counter.",
  },
  {
    numeral: "02",
    title: "Choose Your Instruments",
    description:
      "Select a strategy, set your sizing, slippage, and manners — how aggressive the machine may be.",
  },
  {
    numeral: "03",
    title: "Retire for the Evening",
    description:
      "The automatons work the trenches around the clock. You receive dispatches when positions open, close, or misbehave.",
  },
];

const STATS = [
  { value: "400ms", label: "Median time to fill" },
  { value: "24/7", label: "Hours kept by the house" },
  { value: "0", label: "Naps taken by the machine" },
  { value: "100%", label: "Of your keys kept by you" },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        {/* ─── Hero ─── */}
        <section className="relative overflow-hidden">
          {/* Subtle radial glow behind the heading */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[600px] w-[600px] rounded-full bg-accent/8 blur-[120px]" />
          </div>

          <div className="relative mx-auto max-w-4xl px-4 pt-24 pb-28 text-center sm:px-6 sm:pt-32 sm:pb-36">
            <Reveal>
              <Badge variant="secondary" className="rounded-full px-3 py-1">
                Est. in the Trenches · Solana Mainnet
              </Badge>
            </Reveal>

            <Reveal delay={100}>
              <h1 className="mx-auto mt-10 max-w-3xl font-display text-5xl leading-[1.08] font-medium tracking-tight text-balance sm:text-7xl">
                Automated Trading for the Discerning Trencher
              </h1>
            </Reveal>

            <Reveal delay={200}>
              <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
                While you sleep, our clockwork automatons snipe launches, shadow
                the finest wallets, and guard your positions on Solana — with
                the good manners of a bygone era and the reflexes of a machine.
              </p>
            </Reveal>

            <Reveal delay={300}>
              <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
                <Button
                  size="lg"
                  nativeButton={false}
                  render={<Link href="/pricing" />}
                  className="h-12 px-8 text-base"
                >
                  Get started
                  <ArrowRight className="ml-2 size-4" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/strategies" />}
                  className="h-12 px-8 text-base"
                >
                  Explore strategies
                </Button>
              </div>
            </Reveal>

            <Reveal delay={400}>
              <p className="mt-12 text-sm tracking-wide text-muted-foreground/60">
                No sleep required — the machine keeps watch.
              </p>
            </Reveal>
          </div>
        </section>

        <Ticker />

        {/* ─── Services — Narrative Layout ─── */}
        <section className="mx-auto max-w-5xl px-4 py-24 sm:px-6 sm:py-32">
          <Reveal className="text-center">
            <p className="text-xs font-semibold tracking-[0.25em] uppercase text-accent">
              The House Services
            </p>
            <h2 className="mt-4 font-display text-4xl font-medium sm:text-5xl">
              Four Fine Automatons
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-muted-foreground leading-relaxed">
              Each machine is built for one job in the trenches, and does it
              without complaint, hesitation, or lunch breaks.
            </p>
          </Reveal>

          <div className="mt-20 space-y-0">
            {SERVICES.map((service, i) => (
              <Reveal key={service.title} delay={i * 80}>
                <div className="group relative grid items-center gap-6 border-t border-border/60 py-10 transition-colors duration-500 hover:bg-accent/[0.03] sm:grid-cols-[4rem_1fr_2fr] sm:gap-10 sm:py-12 sm:px-6">
                  {/* Numeral */}
                  <span className="hidden font-display text-3xl font-medium text-accent/30 transition-colors duration-500 group-hover:text-accent sm:block">
                    {service.numeral}
                  </span>

                  {/* Title + Icon */}
                  <div className="flex items-center gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-accent/20 text-accent transition-all duration-500 group-hover:border-accent/50 group-hover:bg-accent/10">
                      <service.icon className="size-[18px]" />
                    </span>
                    <h3 className="font-display text-2xl font-medium">
                      {service.title}
                    </h3>
                  </div>

                  {/* Description */}
                  <p className="text-muted-foreground leading-relaxed sm:text-right">
                    {service.description}
                  </p>
                </div>
              </Reveal>
            ))}
            {/* Bottom border to close the list */}
            <div className="border-t border-border/60" />
          </div>
        </section>

        {/* ─── How It Works — Vertical Timeline ─── */}
        <section className="relative overflow-hidden bg-secondary/40">
          <div className="mx-auto max-w-4xl px-4 py-24 sm:px-6 sm:py-32">
            <Reveal className="text-center">
              <p className="text-xs font-semibold tracking-[0.25em] uppercase text-accent">
                Instructions for Use
              </p>
              <h2 className="mt-4 font-display text-4xl font-medium sm:text-5xl">
                How One Enlists
              </h2>
            </Reveal>

            <div className="relative mt-20">
              {/* Vertical connecting line */}
              <div className="absolute top-0 bottom-0 left-5 w-px bg-gradient-to-b from-accent/40 via-accent/20 to-transparent sm:left-1/2 sm:-translate-x-px" />

              {STEPS.map((step, i) => {
                const isEven = i % 2 === 0;
                return (
                  <Reveal key={step.numeral} delay={i * 150}>
                    <div className="relative mb-16 last:mb-0 sm:flex sm:items-start">
                      {/* Timeline dot */}
                      <div className="absolute left-5 top-0 z-10 -translate-x-1/2 sm:left-1/2">
                        <span className="flex size-10 items-center justify-center rounded-full border-2 border-accent/30 bg-background font-display text-sm font-medium text-accent">
                          {step.numeral}
                        </span>
                      </div>

                      {/* Content — alternates left/right on desktop */}
                      <div
                        className={`ml-14 sm:ml-0 sm:w-[calc(50%-2.5rem)] ${isEven
                          ? "sm:mr-auto sm:pr-8 sm:text-right"
                          : "sm:ml-auto sm:pl-8"
                          }`}
                      >
                        <h3 className="font-display text-xl font-medium">
                          {step.title}
                        </h3>
                        <p className="mt-3 text-muted-foreground leading-relaxed">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─── Stats — Inline Narrative Row ─── */}
        <section className="border-y border-border/60">
          <div className="mx-auto grid max-w-5xl grid-cols-2 divide-x divide-border/60 sm:grid-cols-4">
            {STATS.map((stat, i) => (
              <Reveal key={stat.label} delay={i * 80}>
                <div className="px-4 py-14 text-center sm:px-6">
                  <p className="font-display text-4xl font-medium text-accent sm:text-5xl">
                    {stat.value}
                  </p>
                  <p className="mt-3 text-xs tracking-wide uppercase text-muted-foreground">
                    {stat.label}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ─── Testimonial — Full-Width Narrative ─── */}
        <section className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6 sm:py-32">
          <Reveal>
            <span className="inline-block font-display text-6xl leading-none text-accent/40 select-none">
              &ldquo;
            </span>
            <blockquote className="-mt-4 font-display text-2xl leading-snug font-medium text-balance sm:text-3xl">
              I went to bed a poor and tired trencher. I woke to find the
              Sentry had cut my losses at breakfast and the Sniper had caught a
              runner before tea.
            </blockquote>
            <div className="mx-auto mt-8 h-px w-12 bg-accent/30" />
            <p className="mt-6 text-sm tracking-wide text-muted-foreground">
              A Gentleman of the Trenches, Anno Solana
            </p>
          </Reveal>
        </section>

        {/* ─── CTA — Refined ─── */}
        <section className="relative overflow-hidden bg-primary text-primary-foreground">
          {/* Background glow */}
          <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2">
            <div className="h-[400px] w-[600px] rounded-full bg-accent/15 blur-[100px]" />
          </div>

          <div className="relative mx-auto max-w-4xl px-4 py-24 text-center sm:px-6 sm:py-32">
            <Reveal>
              <h2 className="font-display text-4xl font-medium leading-tight text-balance sm:text-5xl">
                The Trenches Do Not Sleep.
                <br />
                Neither Do We.
              </h2>
              <p className="mx-auto mt-6 max-w-xl text-primary-foreground/70 leading-relaxed">
                Take a seat in the parlour, choose your automaton, and let the
                machinery mind the charts.
              </p>
              <Button
                size="lg"
                nativeButton={false}
                render={<Link href="/pricing" />}
                className="mt-10 h-12 bg-accent px-8 text-base text-accent-foreground hover:bg-accent/90"
              >
                View pricing
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
