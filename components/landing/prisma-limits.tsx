"use client";

import { ArrowRight } from "lucide-react";
import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

import { WordsPullUpMultiStyle } from "./words-pull-up";

/** Whitepaper §12.1. "Hard stops, non-negotiable" was the old copy here and
 * Appendix D.16 requires this correction: the first operator to gap through
 * a stop will be right, and public about it. */
const EXIT_FAILURES = [
  "The Engine is unavailable",
  "The chain is congested past the exit's fee ceiling",
  "Liquidity is removed inside a single block",
  "Price gaps past the level between two observations",
];

/** §15. Numbers from the first paper cohort, published not as performance
 * but because they show the paper-to-live gap is large enough to invalidate
 * a naive reading of paper P&L. */
const PAPER_GAP = [
  {
    stat: "0",
    unit: "slippage modelled",
    body:
      "Paper fills at the observed mark. A real order of the configured size against a minutes-old pool moves that price, and none of that movement appears in a paper result.",
  },
  {
    stat: "8.59×",
    unit: "one unreachable fill",
    body:
      "An agent set to take profit at +30% recorded an exit at 8.59× because price crossed the threshold and kept going inside a single exit-check interval. That one trade accounted for the cohort's entire apparent profit. Excluding it, the cohort was slightly negative.",
  },
  {
    stat: "21/45",
    unit: "exits past their hold cap",
    body:
      "Positions are only evaluated while the executor process is alive, so a paper record is a record of uptime as much as of strategy. A paper history accumulated against an intermittently running executor is not evidence about a strategy.",
  },
];

/** §17. Only the first two carry "not solvable" in the failure-mode table.
 * The third has a real mitigation and an irreducible residual, so it is
 * labelled as residual rather than promoted to unsolvable. */
const UNSOLVED = [
  {
    label: "Not solvable",
    title: "Chain congestion",
    body:
      "Exits fail exactly when they matter most. Fee escalation helps; it does not solve it.",
  },
  {
    label: "Not solvable",
    title: "Single-block liquidity removal",
    body:
      "The whole position, with no mitigation available. Detection is not escape.",
  },
  {
    label: "Residual, permanently",
    title: "Novel traps outside the gate",
    body:
      "Refuse-by-default and fleet-wide rule updates narrow the surface. Unknown unknowns remain.",
  },
];

const CARD_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function PrismaLimits() {
  const gridRef = useRef<HTMLDivElement>(null);
  const inView = useInView(gridRef, { once: true, margin: "-100px" });

  return (
    <section
      id="limits"
      className="relative bg-black px-4 py-16 sm:px-6 md:px-8 md:py-24"
    >
      <div className="mx-auto max-w-7xl">
        <p className="text-primary text-center text-[10px] tracking-widest uppercase sm:text-xs">
          Honest limits
        </p>

        <h2 className="mx-auto mt-6 max-w-3xl text-center text-xl font-normal sm:text-2xl md:text-3xl lg:text-4xl">
          <WordsPullUpMultiStyle
            segments={[
              {
                text: "What we do not claim.",
                className: "text-primary",
              },
              {
                text: "Nothing on this page reports observed performance, and no figure here is a projection.",
                className: "text-gray-500",
              },
            ]}
          />
        </h2>

        <div
          ref={gridRef}
          className="mt-12 grid grid-cols-1 gap-3 sm:gap-2 md:mt-16 md:gap-1 lg:grid-cols-5"
        >
          <motion.div
            className="flex flex-col rounded-2xl bg-[#212121] p-6 sm:p-8 lg:col-span-2"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={
              inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }
            }
            transition={{ duration: 0.7, ease: CARD_EASE }}
          >
            <h3 className="text-primary text-lg font-medium sm:text-xl">
              There are no stop orders on an AMM
              <span className="text-gray-500">.</span>
            </h3>
            <p className="mt-4 text-xs leading-relaxed text-gray-400 sm:text-sm">
              A &ldquo;stop&rdquo; is Noah observing price and submitting a sell.
              That makes every exit rule-based and automatic, but also
              best-effort, and it can fail to protect you when:
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {EXIT_FAILURES.map((failure) => (
                <li
                  key={failure}
                  className="flex items-baseline gap-2.5 text-xs text-gray-400 sm:text-sm"
                >
                  {/* A dot rather than a dash: the list marker should not
                      read as punctuation inside the sentence it opens. */}
                  <span className="bg-primary/40 mt-[0.45em] size-1 shrink-0 rounded-full" />
                  {failure}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-gray-400 sm:text-sm">
              Memecoins gap violently and single-block liquidity removal is
              common, so these are frequent events rather than edge cases.
            </p>
            <p className="font-instrument mt-6 text-sm italic text-gray-500 sm:text-base">
              No mechanism in this system places a floor under losses. Anything
              calling these guaranteed hard stops is wrong.
            </p>
          </motion.div>

          <motion.div
            className="flex flex-col rounded-2xl bg-[#212121] p-6 sm:p-8 lg:col-span-3"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={
              inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }
            }
            transition={{ delay: 0.15, duration: 0.7, ease: CARD_EASE }}
          >
            <h3 className="text-primary text-lg font-medium sm:text-xl">
              Paper results overstate live results
              <span className="text-gray-500">.</span>
            </h3>
            <p className="mt-4 text-xs leading-relaxed text-gray-400 sm:text-sm">
              Paper mode runs the complete decision pipeline with simulated
              fills. What it cannot reproduce: position within the block,
              priority-fee competition, the slippage your own order would have
              caused, partial fills, and failed transactions. From the first
              paper cohort, 45 closed trades across 5 agents:
            </p>

            <div className="mt-6 grid gap-px overflow-hidden rounded-xl bg-white/5 sm:grid-cols-3">
              {PAPER_GAP.map((item) => (
                <div key={item.unit} className="bg-[#181818] p-4">
                  <p className="text-primary text-2xl font-medium tracking-tight sm:text-3xl">
                    {item.stat}
                  </p>
                  <p className="mt-1 text-[10px] tracking-widest text-gray-500 uppercase">
                    {item.unit}
                  </p>
                  <p className="mt-3 text-xs leading-relaxed text-gray-400">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-5 text-xs leading-relaxed text-gray-500">
              A measured paper-to-live degradation figure needs live fills to
              compare against, and none exist yet. When there are, the number
              gets published whichever way it lands.
            </p>
          </motion.div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:gap-2 md:grid-cols-3 md:gap-1">
          {UNSOLVED.map((item, i) => (
            <motion.div
              key={item.title}
              className="rounded-2xl bg-[#141414] p-6 ring-1 ring-white/5"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={
                inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }
              }
              transition={{
                delay: 0.3 + i * 0.12,
                duration: 0.7,
                ease: CARD_EASE,
              }}
            >
              <p className="text-[10px] tracking-widest text-gray-500 uppercase">
                {item.label}
              </p>
              <h3 className="text-primary mt-3 text-base font-medium">
                {item.title}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-gray-400 sm:text-sm">
                {item.body}
              </p>
            </motion.div>
          ))}
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            href="/whitepaper#section-17"
            className="text-primary group flex items-center gap-1.5 text-xs sm:text-sm"
          >
            Read the full failure-mode table
            <ArrowRight className="h-4 w-4 -rotate-45 transition-transform group-hover:rotate-0" />
          </Link>
        </div>
      </div>
    </section>
  );
}
