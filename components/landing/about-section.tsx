"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";

export function AboutSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      id="about"
      ref={ref}
      className="relative overflow-hidden bg-black px-6 pt-32 pb-10 md:pt-44 md:pb-14"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(94,210,156,0.06)_0%,_transparent_70%)]" />

      <div className="relative mx-auto max-w-5xl">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-sm tracking-widest uppercase text-white/40"
        >
          The Mission
        </motion.p>

        <motion.h2
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="mt-8 text-4xl leading-[1.1] tracking-tight text-white md:text-6xl lg:text-7xl"
        >
          Hands-on curriculum{" "}
          <em className="font-instrument italic text-white/60">for builders</em>{" "}
          who
          <br className="hidden md:block" /> learn by{" "}
          <em className="font-instrument italic text-white/60">
            shipping real projects.
          </em>
        </motion.h2>
      </div>
    </section>
  );
}
