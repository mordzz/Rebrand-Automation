"use client";

import { motion } from "motion/react";

import type { FeeSplitConfig } from "@/lib/perps/perpspad-types";
import { useFeeSplit } from "./use-fee-split";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const STEPS = [
  {
    step: "01",
    title: "Create Token",
    description:
      "Choose your underlying market (BTC, ETH…), pick a direction (LONG or SHORT), set your target leverage, and deposit initial USDC collateral.",
    icon: (
      <svg
        className="size-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 4.5v15m7.5-7.5h-15"
        />
      </svg>
    ),
  },
  {
    step: "02",
    title: "Trade the Token",
    description:
      "Your token is listed on a Meteora liquidity pool. Every swap generates trading fees that are collected by the keeper bot for distribution.",
    icon: (
      <svg
        className="size-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
        />
      </svg>
    ),
  },
  {
    step: "03",
    title: "Autonomous Keeper",
    // Percentages come from the live config, not a fourth hardcoded copy
    // of "50/25/25" - see components/perps/use-fee-split.ts.
    description: (s: FeeSplitConfig) =>
      `Every ~60 seconds the keeper claims fees and splits them: ${s.collateralTopUp}% tops up the perp collateral, ${s.tokenBuybackBurn}% buys back and burns the token, ${s.governanceBuybackBurn}% strengthens governance.`,
    icon: (
      <svg
        className="size-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
        />
      </svg>
    ),
  },
  {
    step: "04",
    title: "Resilient by Design",
    description:
      "If a position gets liquidated, the token persists. The keeper accumulates fees until enough collateral is gathered to re-open the position automatically.",
    icon: (
      <svg
        className="size-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
        />
      </svg>
    ),
  },
];

export function HowItWorks() {
  const feeSplit = useFeeSplit();

  return (
    <section
      id="how-it-works"
      className="scroll-mt-24 border-t border-white/6 py-14"
    >
      <div>
        <p className="text-primary text-[10px] tracking-[0.3em] uppercase sm:text-xs">
          How it works
        </p>
        <h2 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">
          From launch to{" "}
          <em className="font-instrument font-normal italic text-foreground/60">
            autonomous flywheel.
          </em>
        </h2>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.step}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.6, delay: i * 0.1, ease: EASE }}
              className="group relative rounded-2xl border border-white/8 bg-white/[0.02] p-6 transition-colors duration-300 hover:border-white/12 hover:bg-white/[0.035]"
            >
              {/* Step number */}
              <div className="mb-4 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                  {step.icon}
                </span>
                <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Step {step.step}
                </span>
              </div>

              <h3 className="text-base font-semibold tracking-tight">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {typeof step.description === "function"
                  ? step.description(feeSplit)
                  : step.description}
              </p>

              {/* Subtle corner glow on hover */}
              <div
                aria-hidden
                className="pointer-events-none absolute -top-px -right-px size-16 rounded-full bg-primary/0 blur-2xl transition-all duration-500 group-hover:bg-primary/8"
              />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
