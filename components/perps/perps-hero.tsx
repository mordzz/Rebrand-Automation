"use client";

import { motion } from "motion/react";
import Link from "next/link";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* Three claims the product actually makes, stated plainly. Deliberately
   not metrics. Perpspad launches are paused: these describe how the
   historical Solana/Drift launches worked, not a live product. */
const PILLARS = [
  {
    title: "Real perp backing",
    body: "Each historical token mapped to its own isolated position on Drift (Solana).",
  },
  {
    title: "Fees compound",
    body: "Pool trading fees routed back into collateral and burns.",
  },
  {
    title: "Runs itself",
    body: "A keeper claimed, split and settled fees on a fixed cadence.",
  },
];

export function PerpsHero() {
  return (
    <section className="relative pt-4 pb-14">
      <div className="relative">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1"
        >
          <span className="size-1.5 rounded-full bg-[#5ed29c]" />
          <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
            Perpspad · paused
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
          className="mt-5 text-4xl font-medium tracking-tight sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]"
        >
          Every token is a{" "}
          <em className="font-instrument font-normal italic text-foreground/60">
            real position.
          </em>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.16, ease: EASE }}
          className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base"
        >
          Launch a token backed by a live perpetual futures position. Trading
          fees auto compound into collateral, buy back and burn the token, and
          strengthen the governance treasury — all onchain, all autonomous.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.28, ease: EASE }}
          className="mt-7 flex flex-wrap items-center gap-3"
        >
          <Link
            href="#create"
            className="group inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-black transition-shadow hover:shadow-[0_0_28px_rgba(222,219,200,0.28)]"
            style={{ background: "#DEDBC8" }}
          >
            Launch Token
            <svg
              className="size-4 transition-transform group-hover:translate-x-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </Link>

          <Link
            href="#how-it-works"
            className="inline-flex items-center rounded-xl border border-white/10 px-5 py-2.5 text-sm font-medium text-foreground/70 transition-colors hover:border-white/20 hover:text-foreground"
          >
            How it works
          </Link>
        </motion.div>
      </div>

      {/* Pillars */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.36, ease: EASE }}
        className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/6 sm:grid-cols-3"
      >
        {PILLARS.map((p) => (
          <div key={p.title} className="bg-background p-5">
            <h3 className="text-xs font-semibold tracking-tight">{p.title}</h3>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              {p.body}
            </p>
          </div>
        ))}
      </motion.div>
    </section>
  );
}
