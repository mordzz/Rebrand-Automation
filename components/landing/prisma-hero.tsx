"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { NavPill } from "@/components/nav-pill";
import { FlickeringGrid } from "@/components/ui/flickering-grid";

import { CopyAddress } from "./copy-address";
import { WordsPullUp } from "./words-pull-up";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* NOTE: this contradicts what the rest of the site currently says. The
   fine print directly below, §19 of the whitepaper, §9 of the Terms, and
   the pricing section all state there is no token and that any token
   claiming association with Noah Engine is fraudulent. Publishing an
   address here while those stand tells a reader one of the two is a lie.
   Left for the owner to resolve rather than edited away silently. */
const CONTRACT_ADDRESS = "361S7aDFRo64BHV662nBvvZWVR3Df6P5pHBKhhg6pump";

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
        {/* pb clears the wordmark's descender: leading-[0.85] pulls the line
            box tighter than the glyphs, so the tail of the "g" would other-
            wise be clipped by the rounded frame's bottom edge. */}
        <div className="absolute right-0 bottom-0 left-0 px-4 pb-6 sm:px-6 md:px-8 md:pb-9">
          <div className="grid grid-cols-12 items-end gap-x-4 gap-y-6">
            <div className="col-span-12 md:col-span-8">
              {/* The same mark the navbar and footer carry, so the brand
                  reads as one lockup rather than two treatments. The pill
                  above shows mark + wordmark inside this very frame. Sized
                  in vw off the wordmark's own scale so the pair stays
                  proportional at every breakpoint, and it rises with the
                  wordmark rather than ahead of it. */}
              <motion.div
                className="mb-3 md:mb-5"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.7, ease: EASE }}
              >
                <Logo className="w-[11vw] text-black sm:w-[10vw] md:w-[8vw] lg:w-[7.5vw] xl:w-[7vw]" />
              </motion.div>

              <WordsPullUp
                text="Noah Engine"
                showAsterisk
                className="text-[16.5vw] leading-[0.85] font-medium tracking-[-0.07em] whitespace-nowrap text-black sm:text-[15.5vw] md:text-[12.5vw] lg:text-[12vw] xl:text-[11.5vw] 2xl:text-[12vw]"
              />
            </div>

            {/* Bottom-aligned with the wordmark's baseline, not its descender,
                so the two columns read as one line rather than stepping. */}
            <div className="col-span-12 flex flex-col items-start gap-5 md:col-span-4 md:pb-4">
              {/* Copy tracks the whitepaper §1 abstract. It deliberately
                  does not say "never makes the same mistake twice"; see
                  Appendix D.17; losses are analysed, and recurring causes
                  become changes the operator reviews. */}
              <motion.p
                className="text-xs leading-[1.2] text-black/70 sm:text-sm md:text-base"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.8, ease: EASE }}
              >
                A public fleet of autonomous trading agents on Solana. Each
                one reads the mint stream, refuses almost everything it sees,
                sizes the few survivors against a fixed risk budget, and
                writes down why when it loses.
              </motion.p>

              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <MotionLink
                  href="/deploy"
                  className="group flex items-center gap-2 rounded-full bg-black py-1.5 pr-1.5 pl-5 text-sm font-medium text-[#E1E0CC] transition-all hover:gap-3 sm:text-base"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7, duration: 0.8, ease: EASE }}
                >
                  Deploy Agent
                  <span className="bg-primary flex h-9 w-9 items-center justify-center rounded-full text-black transition-transform group-hover:scale-110 sm:h-10 sm:w-10">
                    <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
                  </span>
                </MotionLink>

                <MotionLink
                  href="/whitepaper"
                  className="text-sm text-black/60 underline decoration-black/25 underline-offset-4 transition-colors hover:text-black"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8, duration: 0.8, ease: EASE }}
                >
                  Read the whitepaper
                </MotionLink>
              </div>

              <motion.div
                className="w-full min-w-0"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.9, duration: 0.8, ease: EASE }}
              >
                <CopyAddress address={CONTRACT_ADDRESS} label="CA" />
              </motion.div>

              <motion.p
                className="text-[10px] leading-[1.4] text-black/45 sm:text-[11px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1, duration: 0.8, ease: EASE }}
              >
                Every agent ships in paper mode. No performance claims, no
                leaderboard, no token. Memecoin trading can lose everything
                you put in.
              </motion.p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
