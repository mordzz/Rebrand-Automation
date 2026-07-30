"use client";

import { ArrowRight, Check } from "lucide-react";
import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

import { FlickeringGrid } from "@/components/ui/flickering-grid";

import { WordsPullUpMultiStyle } from "./words-pull-up";

/** Whitepaper §9. The tiers are ordered by data cost, and the latency
 * labels are the design budget from Appendix B, not measured figures,
 * which is why they read as budgets here too. */
const TIERS = [
  {
    number: "00",
    name: "Tier 0",
    latency: "<10ms · zero extra RPC",
    tagline: "Read straight from the transaction that created the pool.",
    items: [
      "Mint authority must be revoked",
      "Freeze authority must be revoked",
      "Transfer hook, permanent delegate or non-transferable: refused",
      "Fee config authority still live: refused, not just a low fee today",
    ],
  },
  {
    number: "01",
    name: "Tier 1",
    latency: "50 to 150ms · bounded RPC",
    tagline: "The checks worth one network round trip.",
    items: [
      "Pool reserves against a liquidity floor",
      "LP burn or lock, unlock timestamp recorded",
      "Top-10 concentration and deployer holdings",
      "Sell simulation from the agent's own wallet, at real size",
    ],
  },
  {
    number: "02",
    name: "Tier 2",
    latency: "seconds · parallel, never blocking",
    tagline: "Depth that cannot fit inside the entry window.",
    items: [
      "Deployer history and how their prior mints ended",
      "Funding-graph analysis of the early buyers",
      "Same-slot buy clusters from linked wallets",
    ],
  },
];

/** Whitepaper §9.5. The first row is the one that matters: it is the only
 * defence against a honeypot that permits sells for an opening window. */
const REVERIFY = [
  ["Sell simulation starts failing", "Emergency exit, highest priority"],
  ["Effective sell tax rises", "Immediate exit"],
  ["LP unlock window approaching", "Forced exit before it opens"],
  ["Liquidity drops below floor", "Immediate exit"],
  ["Authority state changed", "Immediate exit"],
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
              <p className="mt-3 max-w-md text-xs leading-relaxed text-gray-300 sm:text-sm">
                A token has to affirmatively pass every applicable check.
                Missing or unreadable data is a failure, never a pass. If an
                RPC times out or an account will not parse, the candidate is
                refused, and an unrecognised Token-2022 extension is treated as
                hostile rather than ignored.
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
              is re-verified on a cycle.
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
              The first row closes the worst gap a single-pass gate leaves: a
              time-delayed honeypot, where sells succeed for an opening window
              and are then switched off. Only repeated simulation catches it.
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
