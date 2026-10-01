"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";

const PHILOSOPHY_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260307_083826_e938b29f-a43a-41ec-a153-3d4730578ab8.mp4";

const BLOCKS = [
  {
    label: "Choose your track",
    body: "Four learning tracks, each built around one outcome. Frontend Engineering ships polished interfaces, Backend & Systems builds APIs that hold up under load, Data Structures & Algorithms gets you interview-ready, and Career Studio turns your work into a hireable portfolio. Take one, or work through the whole curriculum.",
  },
  {
    label: "Learn on your schedule",
    body: "Lessons, projects, and mentor feedback fit around your week - mornings before work, nights after the kids are asleep, whenever you have an hour. Every submission gets reviewed by a real engineer, not an autograder.",
  },
];

export function PhilosophySection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      id="insights"
      ref={ref}
      className="overflow-hidden bg-black px-6 py-28 md:py-40"
    >
      <div className="mx-auto max-w-6xl">
        <motion.h2
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="mb-16 text-5xl tracking-tight text-white md:mb-24 md:text-7xl lg:text-8xl"
        >
          Practice <em className="font-instrument italic text-white/40">x</em>{" "}
          Mentorship
        </motion.h2>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-12">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="aspect-[4/3] overflow-hidden rounded-3xl"
          >
            <video
              className="h-full w-full object-cover"
              src={PHILOSOPHY_VIDEO}
              muted
              autoPlay
              loop
              playsInline
              preload="auto"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="flex flex-col justify-center"
          >
            {BLOCKS.map((block, i) => (
              <div key={block.label}>
                {i > 0 && <div className="my-10 h-px w-full bg-white/10" />}
                <p className="mb-4 text-xs tracking-widest uppercase text-white/40">
                  {block.label}
                </p>
                <p className="text-base leading-relaxed text-white/70 md:text-lg">
                  {block.body}
                </p>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
