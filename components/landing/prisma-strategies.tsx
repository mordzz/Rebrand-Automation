"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";

import { WordsPullUpMultiStyle } from "./words-pull-up";

/** Whitepaper §10. Three instincts, not four: the confirmation-based second
 * entry ("The Wake") was removed rather than deferred, and the note below
 * the grid says so instead of quietly dropping it from the list. */
const INSTINCTS = [
  {
    number: "01",
    name: "The Raven",
    role: "Generates",
    tagline: "The only instinct that opens a position.",
    description:
      "Acts on Tier 0 and Tier 1 verdicts, because nothing slower completes inside the window a fresh launch gives you. It cannot size itself: what it may risk is decided elsewhere, and it has no authority to argue.",
  },
  {
    number: "02",
    name: "The Ark",
    role: "Constrains",
    tagline: "Guards every position the fleet holds.",
    description:
      "Opens nothing. Arms breakeven once a position is meaningfully green, tightens exits as momentum decays, and exits on stall, drawdown, or crash. Exits are rule-based and best-effort, because there are no stop orders on an AMM.",
  },
  {
    number: "03",
    name: "The Tide",
    role: "Constrains",
    tagline: "Session authority. When it calls the day, the day is over.",
    description:
      "Sizing against the risk budget, enforcement of every operator limit, the daily loss limit that ends a session, and the cadence that turns post-mortems into configuration changes you review before they apply.",
  },
];

/** Whitepaper §5, verbatim in intent. Each one is a claim the rest of the
 * document has to keep, which is why they are stated as rules and not as
 * benefits. */
const PRINCIPLES = [
  "Refuse by default.",
  "Rules before positions.",
  "Paper first.",
  "Operator limits are hard limits.",
  "Rank survival, never profit.",
  "No model in the trade path.",
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
          The instincts
        </p>

        <h2 className="mx-auto mt-6 max-w-3xl text-center text-xl font-normal sm:text-2xl md:text-3xl lg:text-4xl">
          <WordsPullUpMultiStyle
            segments={[
              {
                text: "One generates. Two constrain.",
                className: "text-primary",
              },
              {
                text: "In every conflict, the constraining instincts win by pipeline ordering, not by policy.",
                className: "text-gray-500",
              },
            ]}
          />
        </h2>

        <div
          ref={gridRef}
          className="mt-12 grid grid-cols-1 gap-3 sm:gap-2 md:mt-16 md:grid-cols-3 md:gap-1"
        >
          {INSTINCTS.map((instinct, i) => (
            <motion.div
              key={instinct.number}
              className="flex flex-col rounded-2xl bg-[#212121] p-6"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={
                inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }
              }
              transition={{ delay: i * 0.15, duration: 0.7, ease: CARD_EASE }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-instrument text-primary/50 text-2xl italic">
                  {instinct.number}
                </span>
                <span className="text-[9px] tracking-widest text-gray-500 uppercase">
                  {instinct.role}
                </span>
              </div>

              <h3 className="text-primary mt-4 text-lg font-medium">
                {instinct.name}
                <span className="text-gray-500">.</span>
              </h3>
              <p className="font-instrument mt-1 text-sm italic text-gray-400">
                {instinct.tagline}
              </p>

              <p className="mt-4 text-xs leading-relaxed text-gray-400 sm:text-sm">
                {instinct.description}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.div
          className="mx-auto mt-3 max-w-4xl rounded-2xl bg-[#141414] p-6 ring-1 ring-white/5"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.5, duration: 0.7, ease: CARD_EASE }}
        >
          <p className="text-[10px] tracking-widest text-gray-500 uppercase">
            On the instinct that used to be here
          </p>
          <p className="mt-3 text-xs leading-relaxed text-gray-400 sm:text-sm">
            Earlier versions listed a fourth instinct: a slower,
            confirmation-based entry allowed a larger position because it acted
            on more complete information. It has been removed rather than
            deferred. It depended on Tier 2 arriving before entry, which the
            latency budget does not allow. A second way to buy also doubles the
            surface to validate while the first one still has no live track
            record. A platform whose thesis is restraint should not ship two
            entries before it can show one works.
          </p>
        </motion.div>

        <div className="mx-auto mt-10 flex max-w-5xl flex-wrap items-start justify-center gap-x-8 gap-y-3">
          {PRINCIPLES.map((principle, i) => (
            <p
              key={principle}
              className="flex items-baseline gap-2 text-xs text-gray-500"
            >
              <span className="font-instrument text-primary/60 italic">
                {String(i + 1).padStart(2, "0")}
              </span>
              {principle}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
