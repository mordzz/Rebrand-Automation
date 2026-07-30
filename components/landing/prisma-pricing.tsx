"use client";

import { ArrowRight, Check } from "lucide-react";
import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

import { WordsPullUpMultiStyle } from "./words-pull-up";

const TIERS = [
  {
    number: "01",
    name: "Paper",
    price: "0",
    unit: "SOL",
    cadence: "free forever",
    blurb: "The full engine in dry-run mode. Watch it trade on paper first.",
    featured: false,
    features: [
      "Every strategy, in dry-run mode",
      "Paper positions & simulated P&L",
      "Live mint feed access",
      "Loss post-mortems included",
      "No wallet required",
    ],
    cta: "Start on paper",
  },
  {
    number: "02",
    name: "Operator",
    price: "0.5",
    unit: "SOL",
    cadence: "per month",
    blurb: "One live agent trading your wallet, inside the limits you set.",
    featured: true,
    features: [
      "Everything in Paper",
      "Live execution from your wallet",
      "Hard stops & trailing exits",
      "Lessons tuned to your config",
      "One-tap kill switch",
    ],
    cta: "Deploy your agent",
  },
  {
    number: "03",
    name: "Desk",
    price: "Custom",
    unit: null,
    cadence: "billed annually",
    blurb: "Multiple agents in parallel for funds and serious operators.",
    featured: false,
    features: [
      "Everything in Operator, per agent",
      "Custom strategy parameters",
      "Private model connections",
      "Priority execution infra",
      "A dedicated desk engineer",
    ],
    cta: "Talk to the desk",
  },
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
                text: "Pay for the engine, not the promises.",
                className: "text-primary",
              },
              {
                text: "Paper-trade free. Go live when you trust it.",
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

        <p className="mt-8 text-center text-xs text-gray-500 sm:text-sm">
          No lock-in · Halt the agent whenever you please.
        </p>
      </div>
    </section>
  );
}
