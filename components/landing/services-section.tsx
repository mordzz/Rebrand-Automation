"use client";

import { ArrowUpRight } from "lucide-react";
import { motion, useInView } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

const VIDEO_CARDS = [
  {
    tag: "Track No. 1",
    title: "Frontend Engineering",
    description:
      "React, TypeScript, and component architecture — build production-grade interfaces and ship a portfolio-ready capstone reviewed by a senior frontend engineer.",
    video:
      "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4",
  },
  {
    tag: "Track No. 2",
    title: "Backend & Systems",
    description:
      "APIs, databases, and infrastructure that hold up under real traffic — design, build, and deploy a service, with your own tests and your own on-call runbook.",
    video:
      "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260324_151826_c7218672-6e92-402c-9e45-f1e0f454bdc4.mp4",
  },
];

const TEXT_CARDS = [
  {
    tag: "Track No. 3",
    title: "Data Structures & Algorithms",
    description:
      "Think in Big-O, not brute force. Weekly problem sets and mock interviews with working engineers, aimed squarely at the technical screen.",
  },
  {
    tag: "Track No. 4",
    title: "Career Studio",
    description:
      "Resume review, portfolio polish, and mock interviews with people who actually hire. Punctual, structured, and free of empty encouragement.",
  },
];

export function ServicesSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      className="relative overflow-hidden bg-black px-6 py-28 md:py-40"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(94,210,156,0.05)_0%,_transparent_60%)]" />

      <div className="relative mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="mb-12 flex items-end justify-between md:mb-16"
        >
          <h2 className="text-3xl tracking-tight text-white md:text-5xl">
            What you&apos;ll learn
          </h2>
          <p className="hidden text-sm text-white/40 md:block">
            Four curriculum tracks
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          {VIDEO_CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 50 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: i * 0.15 }}
              className="liquid-glass group overflow-hidden rounded-3xl"
            >
              <Link href="/strategies" className="block">
                <div className="relative aspect-video overflow-hidden">
                  <video
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    src={card.video}
                    muted
                    autoPlay
                    loop
                    playsInline
                    preload="auto"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                </div>

                <div className="p-6 md:p-8">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-xs tracking-widest uppercase text-white/40">
                      {card.tag}
                    </p>
                    <span className="liquid-glass rounded-full p-2 text-white transition-transform duration-300 group-hover:rotate-45">
                      <ArrowUpRight size={16} />
                    </span>
                  </div>
                  <h3 className="mb-3 font-instrument text-2xl tracking-tight text-white md:text-3xl">
                    {card.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-white/50">
                    {card.description}
                  </p>
                </div>
              </Link>
            </motion.div>
          ))}

          {TEXT_CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 50 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.3 + i * 0.15 }}
              className="liquid-glass group overflow-hidden rounded-3xl"
            >
              <Link href="/strategies" className="block p-6 md:p-8">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-xs tracking-widest uppercase text-white/40">
                    {card.tag}
                  </p>
                  <span className="liquid-glass rounded-full p-2 text-white transition-transform duration-300 group-hover:rotate-45">
                    <ArrowUpRight size={16} />
                  </span>
                </div>
                <h3 className="mb-3 font-instrument text-2xl tracking-tight text-white md:text-3xl">
                  {card.title}
                </h3>
                <p className="text-sm leading-relaxed text-white/50">
                  {card.description}
                </p>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
