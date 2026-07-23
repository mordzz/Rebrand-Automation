"use client";

import { ArrowRight } from "lucide-react";
import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

const STATS = [
  { value: "4", label: "Curriculum tracks" },
  { value: "1:1", label: "Mentor project reviews" },
  { value: "100%", label: "Project-based, no filler" },
  { value: "0", label: "Autograders" },
];

export function CtaSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      className="relative overflow-hidden bg-black px-6 pb-28 md:pb-40"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(94,210,156,0.06)_0%,_transparent_60%)]" />

      <div className="relative mx-auto max-w-6xl">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.7, delay: i * 0.1 }}
              className="liquid-glass rounded-3xl p-6 text-center md:p-8"
            >
              <p className="font-instrument text-4xl text-white md:text-5xl">
                {stat.value}
              </p>
              <p className="mt-3 text-xs tracking-widest uppercase text-white/40">
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="mt-24 text-center md:mt-32"
        >
          <h2 className="font-instrument text-5xl leading-[1.05] tracking-tight text-white md:text-7xl">
            The curriculum won&apos;t wait.
            <br />
            <em className="italic text-white/60">Neither should you.</em>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-white/50 md:text-base">
            Pick a track, meet your mentor, and start shipping the project
            that lands your next job.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/pricing"
              className="flex items-center gap-2 rounded-full bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-transform hover:scale-105 active:scale-95"
            >
              View pricing
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/deploy"
              className="liquid-glass rounded-full px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-white/5"
            >
              Get started
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
