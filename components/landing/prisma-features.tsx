"use client";

import { ArrowRight, Check } from "lucide-react";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

import { FlickeringGrid } from "@/components/ui/flickering-grid";

import { WordsPullUpMultiStyle } from "./words-pull-up";

const FEATURE_CARDS = [
  {
    number: "01",
    title: "Mint Sniper.",
    icon: "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171918_4a5edc79-d78f-4637-ac8b-53c43c220606.png&w=1280&q=85",
    items: [
      "Watches new mints from block one",
      "Filters rugs and honeypots",
      "Sizes every entry to your risk",
      "Executes in milliseconds",
    ],
  },
  {
    number: "02",
    title: "Loss Post-Mortems.",
    icon: "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171741_ed9845ab-f5b2-4018-8ce7-07cc01823522.png&w=1280&q=85",
    items: [
      "AI analysis of every losing trade",
      "Lessons written to agent memory",
      "Strategy tuned from evidence",
    ],
  },
  {
    number: "03",
    title: "Guarded Autonomy.",
    icon: "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171809_f56666dc-c099-4778-ad82-9ad4f209567b.png&w=1280&q=85",
    items: [
      "Hard stops on every position",
      "Dry-run mode by default",
      "Bound by your risk limits",
    ],
  },
];

const CARD_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const CARD_HOVER = { y: -6, transition: { duration: 0.3, ease: CARD_EASE } };

function cardMotion(inView: boolean, index: number) {
  return {
    initial: { opacity: 0, scale: 0.95 },
    animate: inView
      ? { opacity: 1, scale: 1 }
      : { opacity: 0, scale: 0.95 },
    transition: { delay: index * 0.15, duration: 0.7, ease: CARD_EASE },
  };
}

const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.3 } },
};

const itemVariants = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4, ease: CARD_EASE } },
};

export function PrismaFeatures() {
  const gridRef = useRef<HTMLDivElement>(null);
  const inView = useInView(gridRef, { once: true, margin: "-100px" });

  return (
    <section className="relative min-h-screen bg-black px-4 py-16 sm:px-6 md:px-8 md:py-24">
      <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.15]" />

      <div className="relative mx-auto max-w-7xl">
        <h2 className="mx-auto max-w-3xl text-center text-xl font-normal sm:text-2xl md:text-3xl lg:text-4xl">
          <WordsPullUpMultiStyle
            segments={[
              {
                text: "Desk-grade automation for autonomous traders.",
                className: "text-primary",
              },
              {
                text: "Built for meme coins. Powered by AI.",
                className: "text-gray-500",
              },
            ]}
          />
        </h2>

        <div
          ref={gridRef}
          className="mt-12 grid grid-cols-1 gap-3 sm:gap-2 md:mt-16 md:grid-cols-2 md:gap-1 lg:h-[480px] lg:grid-cols-4"
        >
          {/* ─── Card 1: flickering grid canvas ─── */}
          <motion.div
            className="relative min-h-[320px] overflow-hidden rounded-2xl bg-[#212121] transition-colors duration-300 hover:bg-[#262626] lg:min-h-0"
            {...cardMotion(inView, 0)}
            whileHover={CARD_HOVER}
          >
            <FlickeringGrid
              className="absolute inset-0 size-full"
              squareSize={4}
              gridGap={6}
              color="#DEDBC8"
              maxOpacity={0.35}
              flickerChance={0.1}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            <p
              className="absolute right-5 bottom-5 left-5 text-sm sm:text-base"
              style={{ color: "#E1E0CC" }}
            >
              Reads the chain. Sizes the risk. Learns from every loss.
            </p>
          </motion.div>

          {/* ─── Cards 2–4: checklists ─── */}
          {FEATURE_CARDS.map((card, i) => (
            <motion.div
              key={card.number}
              className="flex flex-col rounded-2xl bg-[#212121] p-5 transition-colors duration-300 hover:bg-[#262626] sm:p-6"
              {...cardMotion(inView, i + 1)}
              whileHover={CARD_HOVER}
            >
              <motion.img
                src={card.icon}
                alt=""
                className="h-10 w-10 rounded object-cover sm:h-12 sm:w-12"
                whileHover={{ scale: 1.08 }}
                transition={{ duration: 0.25, ease: CARD_EASE }}
              />

              <h3 className="text-primary mt-5 text-base sm:text-lg">
                {card.title}{" "}
                <span className="text-gray-500">({card.number})</span>
              </h3>

              <motion.ul
                className="mt-5 flex flex-col gap-3"
                variants={listVariants}
                initial="hidden"
                animate={inView ? "show" : "hidden"}
              >
                {card.items.map((item) => (
                  <motion.li
                    key={item}
                    variants={itemVariants}
                    className="flex items-start gap-2.5"
                  >
                    <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                    <span className="text-xs text-gray-400 sm:text-sm">
                      {item}
                    </span>
                  </motion.li>
                ))}
              </motion.ul>

              <a
                href="#"
                className="text-primary group mt-auto flex items-center gap-1.5 pt-8 text-xs sm:text-sm"
              >
                Learn more
                <ArrowRight className="h-4 w-4 -rotate-45 transition-transform group-hover:rotate-0" />
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
