"use client";

import {
  ArrowRight,
  KeyRound,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wallet,
} from "lucide-react";
import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

import { WordsPullUpMultiStyle } from "./words-pull-up";

/** Step 1 states the custody model as it actually ships (whitepaper §7.1,
 * Model D) and corrects Appendix D.15: the operator's wallet establishes
 * ownership, and the agent trades from a wallet of its own. Step 3 states
 * exits as best-effort rather than "non-negotiable" (D.16). */
const STEPS = [
  {
    number: "01",
    icon: Wallet,
    title: "Sign in with your own wallet.",
    description:
      "Your wallet establishes who owns the agent, and nothing more. Its keys and seed phrase are never requested, never held, never delegated.",
  },
  {
    number: "02",
    icon: Sparkles,
    title: "Name it. Give it a face.",
    description:
      "An image, a GIF, or the Noah 3D bot. The name is yours, checked for uniqueness and lookalikes against the rest of the fleet.",
  },
  {
    number: "03",
    icon: SlidersHorizontal,
    title: "Set the limits it must obey.",
    description:
      "Position size in absolute ETH, a cap on concurrent positions, a daily loss limit, a target and a stop. No component may exceed them, including under retry or restart.",
  },
  {
    number: "04",
    icon: ShieldCheck,
    title: "It trades on paper first.",
    description:
      "Deploying configures an agent; it does not start it, and it does not go live. Losses are analysed, and causes that recur become configuration proposals you accept or decline. Lessons are never silently applied.",
  },
];

/** Shipped defaults: the values a newly deployed agent actually runs
 * (lib/sniper/config.ts#DEFAULT_TRADING_CONFIG), deliberately kept
 * separate from design targets. */
const DEFAULTS = [
  ["Max per entry", "0.0022 ETH"],
  ["Max concurrent", "3 positions"],
  ["Max deployed", "0.0066 ETH"],
  ["Take profit", "50% up"],
  ["Stop level", "20% down"],
  ["Daily loss limit", "0.0044 ETH"],
  ["Consecutive losses", "8, then it halts"],
  ["Mode", "Paper, not started"],
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
                text: "Deploy in four steps.",
                className: "text-primary",
              },
              {
                text: "No seed phrase, ever. No live trade until you say so.",
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
                  <span className="font-instrument text-primary/50 text-2xl italic">
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

        <div className="mt-3 grid grid-cols-1 gap-3 sm:gap-2 md:grid-cols-2 md:gap-1">
          {/* The custody paragraph a reader deciding whether to fund an agent
              actually needs: what is bounded, and what is not. §7.1. */}
          <motion.div
            className="flex flex-col rounded-2xl bg-[#212121] p-6 sm:p-8"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={
              inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }
            }
            transition={{ delay: 0.5, duration: 0.7, ease: CARD_EASE }}
          >
            <KeyRound className="text-primary/50 h-4 w-4" />
            <h3 className="text-primary mt-4 text-lg font-medium sm:text-xl">
              The wallet it trades from
              <span className="text-gray-500">.</span>
            </h3>
            <p className="mt-4 text-xs leading-relaxed text-gray-400 sm:text-sm">
              An agent has to sign while you are asleep, so it gets a wallet of
              its own: deploying generates a fresh Robinhood Chain (EVM) wallet belonging to
              that agent alone, which you fund by deposit. Only what you deposit
              is ever at risk. There is no path from an agent wallet to your
              own, because Noah holds no authority over yours.
            </p>
            <p className="mt-4 text-xs leading-relaxed text-gray-400 sm:text-sm">
              What that does not mean: the agent wallet&rsquo;s key is held by
              the platform, encrypted at rest, and it can sign anything that key
              can sign. That constraint is operational, not cryptographic, and
              it should be read that way. The key is exportable and the balance
              is withdrawable to any address at any time, so you are never
              locked into our custody of it.
            </p>
            <p className="font-instrument mt-5 text-sm italic text-gray-500">
              Deposit only what you are prepared to lose outright, independently
              of how the trading goes.
            </p>
          </motion.div>

          <motion.div
            className="flex flex-col rounded-2xl bg-[#141414] p-6 ring-1 ring-white/5 sm:p-8"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={
              inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }
            }
            transition={{ delay: 0.62, duration: 0.7, ease: CARD_EASE }}
          >
            <p className="text-[10px] tracking-widest text-gray-500 uppercase">
              What a new agent runs, before you change anything
            </p>
            <ul className="mt-5 flex flex-col">
              {DEFAULTS.map(([label, value]) => (
                <li
                  key={label}
                  className="flex items-baseline justify-between gap-4 border-t border-white/5 py-2.5 text-xs sm:text-sm"
                >
                  <span className="text-gray-500">{label}</span>
                  <span className="text-primary/90 shrink-0 font-mono text-[11px] sm:text-xs">
                    {value}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs leading-relaxed text-gray-500">
              Sizes are absolute ETH rather than a share of balance, so a larger
              deposit does not silently scale up your risk. Each entry also
              holds back a fee reserve, so a buy can never leave the wallet
              unable to afford the sale that exits it.
            </p>
          </motion.div>
        </div>

        <div className="mt-12 flex flex-col items-center gap-4">
          <Link
            href="/deploy"
            className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-medium transition-transform hover:scale-105"
          >
            Deploy your agent
            <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="text-center text-[11px] text-gray-600">
            Noah never messages you first, never asks for a deposit to an
            address, and never asks for a seed phrase. Anything that does is
            fraudulent.
          </p>
        </div>
      </div>
    </section>
  );
}
