"use client";

import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

const FEATURED_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260402_054547_9875cfc5-155a-4229-8ec8-b7ba7125cbf8.mp4";

export function FeaturedVideoSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      className="overflow-hidden bg-black px-6 pt-6 pb-20 md:pt-10 md:pb-32"
    >
      <motion.div
        initial={{ opacity: 0, y: 60 }}
        animate={isInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.9 }}
        className="relative mx-auto aspect-video max-w-6xl overflow-hidden rounded-3xl"
      >
        <video
          className="h-full w-full object-cover"
          src={FEATURED_VIDEO}
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        <div className="absolute right-0 bottom-0 left-0 flex flex-col items-start gap-6 p-6 md:flex-row md:items-end md:justify-between md:p-10">
          <div className="liquid-glass max-w-md rounded-2xl p-6 md:p-8">
            <p className="mb-3 text-xs tracking-widest uppercase text-white/50">
              The CodeNest Approach
            </p>
            <p className="text-sm leading-relaxed text-white md:text-base">
              Every course is built around a real project, reviewed by a real
              engineer. No filler lectures, no busywork — just the skills that
              show up on day one of the job.
            </p>
          </div>

          <Link
            href="/strategies"
            className="liquid-glass rounded-full px-8 py-3 text-sm font-medium text-white transition-transform hover:scale-105 active:scale-95"
          >
            Explore the curriculum
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
