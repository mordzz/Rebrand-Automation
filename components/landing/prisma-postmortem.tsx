"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";

import { FlickeringGrid } from "@/components/ui/flickering-grid";

import { WordsPullUpMultiStyle } from "./words-pull-up";

/** Whitepaper §13.1. Step 4 is the one that makes the rest safe to ship:
 * nothing an analysis concludes reaches a live configuration on its own. */
const LOOP = [
  {
    number: "01",
    title: "The loss is packaged.",
    body:
      "On close, a losing position is bundled with its full context: entry conditions, the Manifest verdict at every tier, execution quality against expectation, the exit trigger, and the price path after the exit.",
  },
  {
    number: "02",
    title: "A proximate cause is named.",
    body:
      "Poor fill, exit too tight, an entry signal that did not hold, or a risk that passed the gate and should not have. The last category is the interesting one.",
  },
  {
    number: "03",
    title: "Only repeat causes graduate.",
    body:
      "A cause has to recur above a repetition threshold before it becomes a concrete configuration proposal. A handful of losses in one regime is noise, and treating noise as a lesson is the failure mode here.",
  },
  {
    number: "04",
    title: "You accept it, or you don't.",
    body:
      "Lessons are never silently applied. Gate failures found this way do feed back into the Manifest for the whole fleet, which is how one operator's loss improves everyone else's refusals.",
  },
];

/** §13.4. Published because the loop is the product's most attractive claim
 * and therefore the one most in need of stated limits. */
const CAVEATS = [
  [
    "Small samples mislead",
    "Which is what the repetition threshold is for.",
  ],
  [
    "Recency bias is the natural failure mode",
    "A system tuned on recent losses drifts toward whatever avoided the last drawdown. That is not the same as whatever works.",
  ],
  [
    "Automated analysis can be confidently wrong",
    "Language models write fluent causal accounts that are sometimes simply incorrect. Your review is the safeguard, not a formality.",
  ],
  [
    "Learning efficacy is unproven",
    "Whether accepted lessons measurably improve outcomes is an empirical question we have not answered yet.",
  ],
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

export function PrismaPostMortem() {
  const gridRef = useRef<HTMLDivElement>(null);
  const inView = useInView(gridRef, { once: true, margin: "-100px" });

  return (
    <section
      id="post-mortems"
      className="relative bg-black px-4 py-16 sm:px-6 md:px-8 md:py-24"
    >
      <div className="mx-auto max-w-7xl">
        <p className="text-primary text-center text-[10px] tracking-widest uppercase sm:text-xs">
          The post-mortem loop
        </p>

        <h2 className="mx-auto mt-6 max-w-3xl text-center text-xl font-normal sm:text-2xl md:text-3xl lg:text-4xl">
          <WordsPullUpMultiStyle
            segments={[
              {
                text: "When an agent loses, it writes down why.",
                className: "text-primary",
              },
              {
                text: "Then it asks you before changing anything.",
                className: "text-gray-500",
              },
            ]}
          />
        </h2>

        <div
          ref={gridRef}
          className="mt-12 grid grid-cols-1 gap-3 sm:gap-2 md:mt-16 md:grid-cols-2 md:gap-1 lg:grid-cols-4"
        >
          {LOOP.map((step, i) => (
            <motion.div
              key={step.number}
              className="flex flex-col rounded-2xl bg-[#212121] p-6 transition-colors duration-300 hover:bg-[#262626]"
              {...cardMotion(inView, i)}
              whileHover={CARD_HOVER}
            >
              <span className="font-instrument text-primary/50 text-2xl italic">
                {step.number}
              </span>
              <h3 className="text-primary mt-3 text-base font-medium sm:text-lg">
                {step.title}
              </h3>
              <p className="mt-3 text-xs leading-relaxed text-gray-400 sm:text-sm">
                {step.body}
              </p>
            </motion.div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:gap-2 md:grid-cols-2 md:gap-1">
          {/* Appendix D.18: the specific mechanism, in place of "Powered by
              AI". The claim is more credible than the slogan it replaces. */}
          <motion.div
            className="relative flex flex-col overflow-hidden rounded-2xl bg-[#212121] p-6 sm:p-8"
            {...cardMotion(inView, 4)}
          >
            <FlickeringGrid
              className="absolute inset-0 size-full opacity-40"
              squareSize={4}
              gridGap={6}
              color="#DEDBC8"
              maxOpacity={0.3}
              flickerChance={0.1}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/45 to-transparent" />
            <div className="relative">
              <h3 className="text-primary text-lg font-medium sm:text-xl">
                No language model sits in the trade path
                <span className="text-gray-500">.</span>
              </h3>
              <p className="mt-4 text-xs leading-relaxed text-gray-300 sm:text-sm">
                Model inference takes seconds. The trade path has a budget
                measured in milliseconds. The two are architecturally
                incompatible, and any product implying otherwise is describing
                something that cannot work at this speed.
              </p>
              <p className="mt-4 text-xs leading-relaxed text-gray-300 sm:text-sm">
                Models are used out of band only, to analyse a position after it
                has closed. Every entry, sizing, and exit decision is made by
                deterministic rules whose inputs are logged and reproducible.
              </p>
            </div>
          </motion.div>

          <motion.div
            className="rounded-2xl bg-[#141414] p-6 ring-1 ring-white/5 sm:p-8"
            {...cardMotion(inView, 5)}
          >
            <p className="text-[10px] tracking-widest text-gray-500 uppercase">
              Where the loop can be wrong
            </p>
            <ul className="mt-5 flex flex-col">
              {CAVEATS.map(([title, body]) => (
                <li
                  key={title}
                  className="border-t border-white/5 py-3 text-xs leading-relaxed sm:text-sm"
                >
                  <span className="text-primary/90">{title}. </span>
                  <span className="text-gray-500">{body}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs leading-relaxed text-gray-500">
              Individual post-mortems are kept in full and immutably, and the
              whole record is yours: exportable in a machine-readable format at
              any time, whatever happens to the agent.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
