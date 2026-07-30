"use client";

import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { WordsPullUpMultiStyle } from "./words-pull-up";

/** Whitepaper §9.7. These lines are the feed's shape, not a live capture,
 * labelled as such below the frame, because a fabricated feed presented as
 * real would undercut the one claim this section exists to make.
 *
 * Timestamps are hard-coded rather than derived from the clock: the list is
 * rendered on the server too, and Date.now() there would not match the
 * client's first paint. */
const LINES = [
  { time: "17:04:12", tier: "T0", agent: "Sisyphus", verb: "refused", mint: "4Hq2…", reason: "freeze authority active" },
  { time: "17:04:12", tier: "T0", agent: "Little Boat", verb: "refused", mint: "4Hq2…", reason: "freeze authority active" },
  { time: "17:04:15", tier: "T0", agent: "Driftwood", verb: "refused", mint: "7Ty9…", reason: "transfer hook present" },
  { time: "17:04:19", tier: "T1", agent: "Sisyphus", verb: "refused", mint: "9Kp7…", reason: "top-10 holds 61%" },
  { time: "17:04:23", tier: "T1", agent: "Driftwood", verb: "refused", mint: "Bn3x…", reason: "sell simulation failed" },
  { time: "17:04:27", tier: "T1", agent: "Little Boat", verb: "refused", mint: "Bn3x…", reason: "liquidity below floor" },
  { time: "17:04:31", tier: "T2", agent: "Little Boat", verb: "refused", mint: "Cw8m…", reason: "deployer: 4 prior rugs" },
  { time: "17:05:44", tier: "T0", agent: "Sisyphus", verb: "refused", mint: "Jm2v…", reason: "mint authority not revoked" },
  { time: "17:06:02", tier: "RV", agent: "Driftwood", verb: "exited", mint: "Ka4p…", reason: "sell simulation began failing" },
];

const TIER_LABEL: Record<string, string> = {
  T0: "Tier 0",
  T1: "Tier 1",
  T2: "Tier 2",
  RV: "Re-verify",
};

const LINE_INTERVAL_MS = 900;
const LOOP_PAUSE_MS = 3200;

export function PrismaRefusalFeed() {
  const frameRef = useRef<HTMLDivElement>(null);
  const inView = useInView(frameRef, { margin: "-80px" });
  // Starts empty so the server-rendered markup and the client's first paint
  // agree; lines only begin arriving once the frame is actually on screen.
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView) return;

    if (shown >= LINES.length) {
      const restart = setTimeout(() => setShown(0), LOOP_PAUSE_MS);
      return () => clearTimeout(restart);
    }

    const next = setTimeout(() => setShown((n) => n + 1), LINE_INTERVAL_MS);
    return () => clearTimeout(next);
  }, [inView, shown]);

  return (
    <section
      id="refusals"
      className="relative bg-black px-4 py-16 sm:px-6 md:px-8 md:py-24"
    >
      <div className="mx-auto max-w-7xl">
        <p className="text-primary text-center text-[10px] tracking-widest uppercase sm:text-xs">
          The refusal feed
        </p>

        <h2 className="mx-auto mt-6 max-w-3xl text-center text-xl font-normal sm:text-2xl md:text-3xl lg:text-4xl">
          <WordsPullUpMultiStyle
            segments={[
              {
                text: "Every rejection is public, with its reason.",
                className: "text-primary",
              },
              {
                text: "The behaviour we actually claim is the behaviour you can watch.",
                className: "text-gray-500",
              },
            ]}
          />
        </h2>

        <div
          ref={frameRef}
          className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-2xl bg-[#0C0C0C] ring-1 ring-white/10 md:mt-16"
        >
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-5">
            <p className="text-[10px] tracking-widest text-gray-500 uppercase">
              fleet · refusals
            </p>
            <p className="flex items-center gap-1.5 text-[10px] tracking-widest text-gray-500 uppercase">
              <span className="bg-primary/70 size-1.5 animate-pulse rounded-full" />
              streaming
            </p>
          </div>

          {/* Fixed height so the frame does not grow line by line and shove
              the rest of the page down while the loop runs. */}
          <div className="h-[19rem] overflow-hidden px-4 py-4 font-mono text-[10px] leading-relaxed sm:px-5 sm:text-xs">
            {LINES.slice(0, shown).map((line, i) => (
              <motion.div
                key={`${line.time}-${line.agent}-${i}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-wrap items-baseline gap-x-2 py-[0.2rem] sm:gap-x-3"
              >
                <span className="text-gray-600">{line.time}</span>
                <span
                  className={
                    line.tier === "RV"
                      ? "text-primary/80 w-[3.5rem] shrink-0"
                      : "w-[3.5rem] shrink-0 text-gray-500"
                  }
                >
                  {line.tier}
                </span>
                <span className="text-primary/90 w-[6.5rem] shrink-0 truncate">
                  {line.agent}
                </span>
                <span
                  className={
                    line.verb === "exited"
                      ? "text-primary w-[4.5rem] shrink-0"
                      : "w-[4.5rem] shrink-0 text-gray-400"
                  }
                >
                  {line.verb}
                </span>
                <span className="w-[3.5rem] shrink-0 text-gray-600">
                  {line.mint}
                </span>
                <span className="text-gray-400">{line.reason}</span>
              </motion.div>
            ))}
            {shown < LINES.length && (
              <span className="bg-primary/60 inline-block h-3 w-1.5 animate-blink align-middle" />
            )}
          </div>
        </div>

        <div className="mx-auto mt-6 grid max-w-4xl gap-x-10 gap-y-3 sm:grid-cols-2">
          <p className="text-xs leading-relaxed text-gray-500">
            A feed of refusals is continuous and cannot be convincingly
            fabricated, which is why it stands in for a marketing claim here.
            Each line carries the tier that produced the verdict:{" "}
            {Object.values(TIER_LABEL).join(", ")}.
          </p>
          <p className="text-xs leading-relaxed text-gray-500">
            One safety gate serves the whole fleet: a verdict is a property of
            a token, not of an operator, so it is computed once per token per
            tier and published to every agent watching. Two agents refusing
            the same mint in the same second is that, not a coincidence.
          </p>
        </div>

        <p className="mt-6 text-center text-[10px] text-gray-600 sm:text-[11px]">
          Illustration of the feed&rsquo;s format and vocabulary. Not a live
          capture, and not a performance record.
        </p>
      </div>
    </section>
  );
}
