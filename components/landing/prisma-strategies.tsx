"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";

import { WordsPullUpMultiStyle } from "./words-pull-up";

const STRATEGIES = [
  {
    number: "01",
    name: "The Raven",
    ships: "Ships dry-run",
    tagline: "First-block entries on fresh mints.",
    description:
      "Watches the pump.fun mint stream from block one and filters hard on creator history, liquidity shape, and holder spread before committing a lamport. Sized entries in milliseconds, tiered targets, and a hard stop set before the trade exists.",
  },
  {
    number: "02",
    name: "The Wake",
    ships: "Ships dry-run",
    tagline: "Follows confirmed momentum, never the rumor.",
    description:
      "Ignores the frantic first minutes and stalks tokens that survive them. Enters behind accelerating volume and holder growth, rides with a trailing stop that only ever tightens, giving up the bottom tick to avoid catching knives.",
  },
  {
    number: "03",
    name: "The Ark",
    ships: "Always on",
    tagline: "Guards every position the engine holds.",
    description:
      "Never opens a trade; it watches all of them. Arms breakeven once a position is meaningfully green, tightens exits when momentum decays, and cuts without ceremony on stall or drawdown. Every other strategy answers to it.",
  },
  {
    number: "04",
    name: "The Tide",
    ships: "Always on",
    tagline: "Discipline on a schedule, not a mood.",
    description:
      "Runs the engine's rhythm: position sizing against the risk budget, daily loss limits that halt the session, and the cadence that turns loss post-mortems into applied config changes. When it calls the day, the day is over.",
  },
];

const RULES = [
  "Every position carries a hard stop.",
  "Ships in dry-run; going live is your call.",
  "Every loss gets a written post-mortem.",
  "Your keys stay yours, always.",
];

const CARD_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function PrismaStrategies() {
  const gridRef = useRef<HTMLDivElement>(null);
  const inView = useInView(gridRef, { once: true, margin: "-100px" });

  return (
    <section
      id="strategies"
      className="relative bg-black px-4 py-16 sm:px-6 md:px-8 md:py-24"
    >
      <div className="mx-auto max-w-7xl">
        <p className="text-primary text-center text-[10px] tracking-widest uppercase sm:text-xs">
          The playbook
        </p>

        <h2 className="mx-auto mt-6 max-w-3xl text-center text-xl font-normal sm:text-2xl md:text-3xl lg:text-4xl">
          <WordsPullUpMultiStyle
            segments={[
              {
                text: "Four strategies, one discipline.",
                className: "text-primary",
              },
              {
                text: "Risk-guarded. Post-mortem-driven. Always learning.",
                className: "text-gray-500",
              },
            ]}
          />
        </h2>

        <div
          ref={gridRef}
          className="mt-12 grid grid-cols-1 gap-3 sm:gap-2 md:mt-16 md:grid-cols-2 md:gap-1 lg:grid-cols-4"
        >
          {STRATEGIES.map((strategy, i) => (
            <motion.div
              key={strategy.number}
              className="flex flex-col rounded-2xl bg-[#212121] p-6"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={
                inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }
              }
              transition={{ delay: i * 0.15, duration: 0.7, ease: CARD_EASE }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-instrument text-2xl italic text-primary/50">
                  {strategy.number}
                </span>
                <span className="text-[9px] tracking-widest text-gray-500 uppercase">
                  {strategy.ships}
                </span>
              </div>

              <h3 className="text-primary mt-4 text-lg font-medium">
                {strategy.name}
                <span className="text-gray-500">.</span>
              </h3>
              <p className="font-instrument mt-1 text-sm italic text-gray-400">
                {strategy.tagline}
              </p>

              <p className="mt-4 text-xs leading-relaxed text-gray-400 sm:text-sm">
                {strategy.description}
              </p>
            </motion.div>
          ))}
        </div>

        <div className="mx-auto mt-10 flex max-w-4xl flex-wrap items-start justify-center gap-x-8 gap-y-3">
          {RULES.map((rule, i) => (
            <p key={rule} className="flex items-baseline gap-2 text-xs text-gray-500">
              <span className="font-instrument text-primary/60 italic">
                {String(i + 1).padStart(2, "0")}
              </span>
              {rule}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
