"use client";

import { ArrowRight, Check } from "lucide-react";
import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

import { FlickeringGrid } from "@/components/ui/flickering-grid";

import { WordsPullUpMultiStyle } from "./words-pull-up";

/** The Robinhood entry gate (lib/gmgn/safety-robinhood.ts), grouped by
 * where each fact comes from. Every check listed here is enforced in code;
 * unknown facts fail closed. */
const TIERS = [
  {
    number: "00",
    name: "Tier 0",
    latency: "discovery feed · no extra request",
    tagline: "Read from the GMGN discovery record itself.",
    items: [
      "Launchpad allow-list and token age window",
      "Blocked keywords and a required website, X or Telegram link",
      "Deployer rug history",
      "Bundler and insider concentration, wash-trading flag",
    ],
  },
  {
    number: "01",
    name: "Tier 1",
    latency: "one security read · per token",
    tagline: "The contract-level facts, fetched once per token.",
    items: [
      "Contract ownership must be renounced",
      "No blacklist capability in the contract",
      "Honeypot flag, buy tax and sell tax limits",
      "Top-10 holder concentration ceiling",
    ],
  },
  {
    number: "02",
    name: "Tier 2",
    latency: "per agent · your rules",
    tagline: "The limits each operator sets on top of the house gate.",
    items: [
      "Creator-holding ceiling, default 10%",
      "A confirmed buy from a tracked wallet, when you require one",
      "Your own age, keyword and social requirements",
    ],
  },
];

/** lib/sniper/exit-logic.ts. Open positions are re-checked against these
 * rules on every exit-check cycle. */
const REVERIFY = [
  ["Price drops sharply within one check", "Emergency exit, highest priority"],
  ["Stop level reached", "Immediate exit"],
  ["Trailing stop or breakeven floor hit", "Immediate exit"],
  ["Take profit reached", "Exit, or sell in tiers"],
  ["Maximum hold time reached", "Forced exit"],
];

const CARD_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const CARD_HOVER = { y: -6, transition: { duration: 0.3, ease: CARD_EASE } };

function cardMotion(inView: boolean, index: number) {
  return {
    initial: { opacity: 0, scale: 0.95 },
    animate: inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 },
    transition: { delay: index * 0.15, duration: 0.7, ease: CARD_EASE },
  };
}

const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.3 } },
};

const itemVariants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4, ease: CARD_EASE } },
};

export function PrismaManifest() {
  const gridRef = useRef<HTMLDivElement>(null);
  const inView = useInView(gridRef, { once: true, margin: "-100px" });

  return (
    <section
      id="manifest"
      className="relative bg-black px-4 py-16 sm:px-6 md:px-8 md:py-24"
    >
      <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.15]" />

      <div className="relative mx-auto max-w-7xl">
        <p className="text-primary text-center text-[10px] tracking-widest uppercase sm:text-xs">
          The Manifest
        </p>

        <h2 className="mx-auto mt-6 max-w-3xl text-center text-xl font-normal sm:text-2xl md:text-3xl lg:text-4xl">
          <WordsPullUpMultiStyle
            segments={[
              {
                text: "Safety precedes strategy.",
                className: "text-primary",
              },
              {
                text: "Tiered by data cost, because depth and speed are not both available at once.",
                className: "text-gray-500",
              },
            ]}
          />
        </h2>

        <div
          ref={gridRef}
          className="mt-12 grid grid-cols-1 gap-3 sm:gap-2 md:mt-16 md:grid-cols-2 md:gap-1 lg:grid-cols-3"
        >
          {TIERS.map((tier, i) => (
            <motion.div
              key={tier.number}
              className="flex flex-col rounded-2xl bg-[#212121] p-5 transition-colors duration-300 hover:bg-[#262626] sm:p-6"
              {...cardMotion(inView, i)}
              whileHover={CARD_HOVER}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-instrument text-primary/50 text-2xl italic">
                  {tier.number}
                </span>
                <span className="text-[9px] tracking-widest text-gray-500 uppercase">
                  {tier.latency}
                </span>
              </div>

              <h3 className="text-primary mt-4 text-lg font-medium">
                {tier.name}
                <span className="text-gray-500">.</span>
              </h3>
              <p className="font-instrument mt-1 text-sm italic text-gray-400">
                {tier.tagline}
              </p>

              <motion.ul
                className="mt-5 flex flex-col gap-3"
                variants={listVariants}
                initial="hidden"
                animate={inView ? "show" : "hidden"}
              >
                {tier.items.map((item) => (
                  <motion.li
                    key={item}
                    variants={itemVariants}
                    className="flex items-start gap-2.5"
                  >
                    <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                    <span className="text-xs text-gray-400 sm:text-sm">
                      {item}
                    </span>
                  </motion.li>
                ))}
              </motion.ul>
            </motion.div>
          ))}
        </div>

        {/* Two properties of the gate that a tier list alone does not convey:
            what happens when a check cannot answer, and the fact that the
            gate keeps running after entry. */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:gap-2 md:grid-cols-2 md:gap-1">
          <motion.div
            className="relative overflow-hidden rounded-2xl bg-[#212121] p-5 sm:p-6"
            {...cardMotion(inView, 3)}
          >
            <FlickeringGrid
              className="absolute inset-0 size-full opacity-40"
              squareSize={4}
              gridGap={6}
              color="#DEDBC8"
              maxOpacity={0.3}
              flickerChance={0.1}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent" />
            <div className="relative">
              <h3 className="text-primary text-lg font-medium">
                Fail closed<span className="text-gray-500">.</span>
              </h3>
              <p className="mt-3 text-xs leading-relaxed text-gray-300 sm:text-sm">
                A token has to affirmatively pass every applicable check.
                Missing or unreadable data is a failure, never a pass. If the
                security read fails, the candidate is refused outright, and an
                unknown honeypot, tax or ownership status is treated as
                hostile rather than ignored.
              </p>
              <p className="mt-4 max-w-md text-xs leading-relaxed text-gray-300 sm:text-sm">
                Passing one tier does not cancel a failure in another. The
                checks work together: a promising entry signal cannot override
                a failed safety check, and a low fee does not make an active
                authority safe.
              </p>
              <p className="mt-4 max-w-md text-xs leading-relaxed text-gray-300 sm:text-sm">
                This is a refusal policy, not a safety guarantee. A token that
                passes has met the applicable checks with the data available at
                that moment. Conditions can still change, which is why the
                gate continues checking after entry.
              </p>
            </div>
          </motion.div>

          <motion.div
            className="rounded-2xl bg-[#212121] p-5 sm:p-6"
            {...cardMotion(inView, 4)}
          >
            <h3 className="text-primary text-lg font-medium">
              And it keeps running after entry
              <span className="text-gray-500">.</span>
            </h3>
            <p className="mt-3 text-xs leading-relaxed text-gray-400 sm:text-sm">
              A pre-trade gate is not enough, because the risks it screens for
              do not stop existing once you hold the token. Every open position
              is re-checked against its exit rules on a cycle.
            </p>
            <ul className="mt-5 flex flex-col gap-2">
              {REVERIFY.map(([condition, response], i) => (
                <li
                  key={condition}
                  className="flex flex-col gap-0.5 border-t border-white/5 pt-2 text-xs sm:flex-row sm:items-baseline sm:justify-between sm:gap-4 sm:text-[13px]"
                >
                  <span className="text-gray-400">{condition}</span>
                  <span
                    className={
                      i === 0
                        ? "text-primary shrink-0 sm:text-right"
                        : "shrink-0 text-gray-500 sm:text-right"
                    }
                  >
                    {response}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs leading-relaxed text-gray-500">
              The first row is the backstop: a sudden collapse inside a single
              check exits immediately instead of waiting for the stop level.
              Exits are rule-based and best-effort, never guaranteed.
            </p>
          </motion.div>
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            href="/whitepaper#section-9"
            className="text-primary group flex items-center gap-1.5 text-xs sm:text-sm"
          >
            Read the Manifest in full
            <ArrowRight className="h-4 w-4 -rotate-45 transition-transform group-hover:rotate-0" />
          </Link>
        </div>
      </div>
    </section>
  );
}
