"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

import { NavPill } from "@/components/nav-pill";
import { FlickeringGrid } from "@/components/ui/flickering-grid";

import { WordsPullUp } from "./words-pull-up";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const MotionLink = motion.create(Link);

export function PrismaHero() {
  return (
    <section className="h-screen p-4 md:p-6">
      <div className="bg-primary relative h-full w-full overflow-hidden rounded-2xl md:rounded-[2rem]">
        {/* ─── Background: flickering grid ─── */}
        <FlickeringGrid
          className="absolute inset-0 z-0 size-full"
          squareSize={4}
          gridGap={6}
          color="#000000"
          maxOpacity={0.5}
          flickerChance={0.1}
        />
        <div className="from-primary via-primary/70 pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t to-transparent" />

        {/* ─── The shared navbar pill, hanging inside the hero frame ─── */}
        <div className="absolute top-0 left-1/2 z-20 -translate-x-1/2">
          <NavPill />
        </div>

        {/* ─── Bottom-aligned hero content ─── */}
        <div className="absolute right-0 bottom-0 left-0 px-4 pb-3 sm:px-6 md:px-8 md:pb-5">
          <div className="grid grid-cols-12 items-end gap-x-4 gap-y-6">
            <div className="col-span-12 md:col-span-8">
              <WordsPullUp
                text="Noah Engine"
                showAsterisk
                className="text-[16.5vw] leading-[0.85] font-medium tracking-[-0.07em] whitespace-nowrap text-black sm:text-[15.5vw] md:text-[12.5vw] lg:text-[12vw] xl:text-[11.5vw] 2xl:text-[12vw]"
              />
            </div>

            <div className="col-span-12 flex flex-col items-start gap-5 pb-2 md:col-span-4 md:pb-6">
              <motion.p
                className="text-xs leading-[1.2] text-black/70 sm:text-sm md:text-base"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.8, ease: EASE }}
              >
                Noah Engine is an autonomous AI agent that trades meme coins
                around the clock, reading live on-chain signals, sniping new
                mints, managing risk, and learning from every loss so it
                never makes the same mistake twice.
              </motion.p>

              <MotionLink
                href="/deploy"
                className="group flex items-center gap-2 rounded-full bg-black py-1.5 pr-1.5 pl-5 text-sm font-medium text-[#E1E0CC] transition-all hover:gap-3 sm:text-base"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7, duration: 0.8, ease: EASE }}
              >
                Start the engine
                <span className="bg-primary flex h-9 w-9 items-center justify-center rounded-full text-black transition-transform group-hover:scale-110 sm:h-10 sm:w-10">
                  <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
              </MotionLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
