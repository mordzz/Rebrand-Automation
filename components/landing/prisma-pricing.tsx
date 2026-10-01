"use client";

import { ArrowRight, Check } from "lucide-react";
import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

import { WordsPullUpMultiStyle } from "./words-pull-up";

/** Whitepaper §19. Denominated in ETH on Robinhood Chain, and charged once at deploy rather
 * than monthly. A weaker recurring-revenue structure, chosen anyway
 * because a monthly charge against a small trading balance is a drag the
 * operator pays whether or not the agent is working (§16.2). */
const TIERS = [
  {
    number: "01",
    name: "Paper",
    price: "0",
    unit: "ETH",
    cadence: "free, no wallet needed",
    blurb:
      "The complete decision pipeline with simulated fills. The right arena to prove a configuration before paying anything.",
    featured: false,
    features: [
      "Every instinct, in dry-run",
      "The full Manifest gate and refusal feed",
      "Loss post-mortems included",
      "Public in the fleet by default",
      "No capital at risk",
    ],
    cta: "Start on paper",
  },
  {
    number: "02",
    name: "Live",
    // Same fiat value as the previous 0.5 SOL fee, at the 2026-10-01 spot
    // snapshot, rounded to the nearest 0.001 ETH.
    price: "0.022",
    unit: "ETH",
    cadence: "once, per deployed agent",
    blurb:
      "One agent trading a wallet of its own, funded by your deposit, inside the limits you set.",
    featured: true,
    features: [
      "Everything in Paper",
      "A dedicated agent wallet of its own",
      "Rule-based automatic exits, best-effort",
      "Circuit breaker on losing streaks",
      "Stop it any time; open positions still exit by their rules",
    ],
    cta: "Deploy your agent",
  },
  {
    number: "03",
    name: "Desk",
    price: "Custom",
    unit: null,
    cadence: "multiple agents",
    blurb:
      "Several agents in parallel, for operators running this as more than one position.",
    featured: false,
    features: [
      "Everything in Live, per agent",
      "Custom parameters across the group",
      "Private model connections",
      "Priority execution infrastructure",
      "A direct line to the people who built it",
    ],
    cta: "Talk to the desk",
  },
];

/** §16.2. Illustrative arithmetic, not measured results: 2% position size,
 * a 35% stop, an average win of 120% of position, 4% round-trip cost, 100
 * trades/month, 0.022 ETH deployed once. Break-even win rate is the no-fee
 * 25.2% (0.39 / 1.55) plus half the fee share. Deposits are the previous
 * SOL examples converted at the same fiat value. Published because a
 * serious reader computes it in two minutes anyway. */
const BREAK_EVEN = [
  ["0.877 ETH", "2.5%", "26.4%"],
  ["0.438 ETH", "5.0%", "27.7%"],
  ["0.219 ETH", "10.0%", "30.2%"],
  ["0.088 ETH", "25.0%", "37.7%"],
  ["0.044 ETH", "50.0%", "50.2%"],
];

const CARD_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function PrismaPricing() {
  const gridRef = useRef<HTMLDivElement>(null);
  const inView = useInView(gridRef, { once: true, margin: "-100px" });

  return (
    <section
      id="pricing"
      className="relative bg-black px-4 py-16 sm:px-6 md:px-8 md:py-24"
    >
      <div className="mx-auto max-w-7xl">
        <p className="text-primary text-center text-[10px] tracking-widest uppercase sm:text-xs">
          Pricing
        </p>

        <h2 className="mx-auto mt-6 max-w-3xl text-center text-xl font-normal sm:text-2xl md:text-3xl lg:text-4xl">
          <WordsPullUpMultiStyle
            segments={[
              {
                text: "One fee, once, in ETH.",
                className: "text-primary",
              },
              {
                text: "Not a subscription. Paper is free for as long as you want it.",
                className: "text-gray-500",
              },
            ]}
          />
        </h2>

        <div
          ref={gridRef}
          className="mt-12 grid grid-cols-1 items-stretch gap-3 sm:gap-2 md:mt-16 md:grid-cols-3 md:gap-1"
        >
          {TIERS.map((tier, i) => (
            <motion.div
              key={tier.name}
              className={
                tier.featured
                  ? "bg-primary flex flex-col rounded-2xl p-6 text-black sm:p-8"
                  : "flex flex-col rounded-2xl bg-[#212121] p-6 sm:p-8"
              }
              initial={{ opacity: 0, scale: 0.95 }}
              animate={
                inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }
              }
              transition={{ delay: i * 0.15, duration: 0.7, ease: CARD_EASE }}
            >
              <p
                className={
                  tier.featured
                    ? "text-[10px] tracking-widest text-black/60 uppercase sm:text-xs"
                    : "text-primary text-[10px] tracking-widest uppercase sm:text-xs"
                }
              >
                Plan {tier.number}
              </p>
              <h3 className="mt-3 text-2xl font-medium tracking-tight sm:text-3xl">
                {tier.name}
                <span
                  className={
                    tier.featured ? "text-black/50" : "text-gray-500"
                  }
                >
                  .
                </span>
              </h3>
              <p
                className={
                  tier.featured
                    ? "mt-2 text-sm leading-relaxed text-black/70"
                    : "mt-2 text-sm leading-relaxed text-gray-400"
                }
              >
                {tier.blurb}
              </p>
              {/* Fixed row height so every card's divider, feature list and
                  CTA land on the same line, whatever the price string is. */}
              <p className="mt-7 flex h-12 items-baseline gap-2 sm:h-14">
                <span className="text-4xl font-medium tracking-tight sm:text-5xl">
                  {tier.price}
                </span>
                {tier.unit && (
                  <span
                    className={
                      tier.featured
                        ? "text-lg font-medium text-black/60 sm:text-xl"
                        : "text-lg font-medium text-gray-500 sm:text-xl"
                    }
                  >
                    {tier.unit}
                  </span>
                )}
                <span
                  className={
                    tier.featured ? "text-xs text-black/60" : "text-xs text-gray-500"
                  }
                >
                  {tier.cadence}
                </span>
              </p>
              <div
                className={
                  tier.featured
                    ? "my-6 h-px w-full bg-black/15"
                    : "my-6 h-px w-full bg-white/10"
                }
              />
              <ul className="space-y-3 text-sm">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check
                      className={
                        tier.featured
                          ? "mt-0.5 h-4 w-4 shrink-0 text-black"
                          : "text-primary mt-0.5 h-4 w-4 shrink-0"
                      }
                    />
                    <span
                      className={
                        tier.featured ? "text-black/70" : "text-gray-400"
                      }
                    >
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href="/deploy"
                className={
                  tier.featured
                    ? "group mt-8 flex items-center justify-between rounded-full bg-black py-1.5 pr-1.5 pl-5 text-sm font-medium text-[#E1E0CC] transition-all"
                    : "group bg-primary mt-8 flex items-center justify-between rounded-full py-1.5 pr-1.5 pl-5 text-sm font-medium text-black transition-all"
                }
              >
                {tier.cta}
                <span
                  className={
                    tier.featured
                      ? "bg-primary flex h-9 w-9 items-center justify-center rounded-full text-black transition-transform group-hover:scale-110"
                      : "flex h-9 w-9 items-center justify-center rounded-full bg-black text-[#E1E0CC] transition-transform group-hover:scale-110"
                  }
                >
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Most products in this category never publish this. A serious
            reader computes it in two minutes regardless (§16), so it is
            better computed here, with the assumptions on the label. */}
        <div className="mx-auto mt-3 w-full max-w-3xl">
          <motion.div
            className="rounded-2xl bg-[#141414] p-6 ring-1 ring-white/5 sm:p-8"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={
              inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }
            }
            transition={{ delay: 0.45, duration: 0.7, ease: CARD_EASE }}
          >
            <p className="text-[10px] tracking-widest text-gray-500 uppercase">
              What the fee costs you, arithmetically
            </p>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[20rem] border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="text-left text-[10px] tracking-widest text-gray-600 uppercase">
                    <th className="pb-2 font-normal">Deposit</th>
                    <th className="pb-2 font-normal">Fee share</th>
                    <th className="pb-2 text-right font-normal">
                      Break-even, month 1
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {BREAK_EVEN.map(([deposit, share, breakEven]) => (
                    <tr key={deposit} className="border-t border-white/5">
                      <td className="py-2 text-gray-400">{deposit}</td>
                      <td className="py-2 font-mono text-[11px] text-gray-500 sm:text-xs">
                        {share}
                      </td>
                      <td className="text-primary/90 py-2 text-right font-mono text-[11px] sm:text-xs">
                        {breakEven}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-white/10">
                    <td className="py-2 text-gray-500" colSpan={2}>
                      Steady state, once amortised
                    </td>
                    <td className="text-primary/90 py-2 text-right font-mono text-[11px] sm:text-xs">
                      25.2%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-5 text-xs leading-relaxed text-gray-500">
              Illustrative only, not measured: 2% position size, a 35% stop, an
              average win of 120% of position, 4% round-trip cost, 100 trades a
              month. Because the fee is one-time it stops mattering once an
              agent has run long enough to amortise it. The first month is where
              a small balance is punished: at 0.044 ETH deposited, half the balance
              is the fee and the arithmetic is close to hopeless before the
              agent has placed a trade.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
