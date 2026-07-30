"use client";

import { ArrowRight, SlidersHorizontal, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

import { WordsPullUpMultiStyle } from "./words-pull-up";

const STEPS = [
  {
    number: "01",
    icon: Wallet,
    title: "Connect your wallet.",
    description:
      "Sign in with Privy. Your keys stay in your wallet; we only ever see your public address.",
  },
  {
    number: "02",
    icon: Sparkles,
    title: "Name your automaton.",
    description:
      "Pick a face: an image, a GIF, or the Noah 3D bot. Then give it a name.",
  },
  {
    number: "03",
    icon: SlidersHorizontal,
    title: "Tune the rules.",
    description:
      "Set position size, stop-loss, and take-profit. Hard stops are non-negotiable, dry-run is the default.",
  },
  {
    number: "04",
    icon: TrendingUp,
    title: "Watch it learn.",
    description:
      "It trades on paper first, and every loss gets a written post-mortem. Go live on the Operator plan whenever you trust it.",
  },
];

const CARD_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function PrismaHowItWorks() {
  const gridRef = useRef<HTMLDivElement>(null);
  const inView = useInView(gridRef, { once: true, margin: "-100px" });

  return (
    <section
      id="how-it-works"
      className="relative bg-black px-4 py-16 sm:px-6 md:px-8 md:py-24"
    >
      <div className="mx-auto max-w-7xl">
        <p className="text-primary text-center text-[10px] tracking-widest uppercase sm:text-xs">
          How it works
        </p>

        <h2 className="mx-auto mt-6 max-w-3xl text-center text-xl font-normal sm:text-2xl md:text-3xl lg:text-4xl">
          <WordsPullUpMultiStyle
            segments={[
              {
                text: "From wallet to watchtower.",
                className: "text-primary",
              },
              {
                text: "No seed phrase shared. No live trade until you say so.",
                className: "text-gray-500",
              },
            ]}
          />
        </h2>

        <div
          ref={gridRef}
          className="mt-12 grid grid-cols-1 gap-3 sm:gap-2 md:mt-16 md:grid-cols-2 md:gap-1 lg:grid-cols-4"
        >
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.number}
                className="flex flex-col rounded-2xl bg-[#212121] p-6"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={
                  inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }
                }
                transition={{ delay: i * 0.15, duration: 0.7, ease: CARD_EASE }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-instrument text-2xl italic text-primary/50">
                    {step.number}
                  </span>
                  <Icon className="text-primary/50 h-4 w-4" />
                </div>

                <h3 className="text-primary mt-4 text-lg font-medium">
                  {step.title}
                </h3>

                <p className="mt-3 text-xs leading-relaxed text-gray-400 sm:text-sm">
                  {step.description}
                </p>
              </motion.div>
            );
          })}
        </div>

        <div className="mt-12 flex justify-center">
          <Link
            href="/deploy"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-transform hover:scale-105"
          >
            Deploy your agent
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
