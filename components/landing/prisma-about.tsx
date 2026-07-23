"use client";

import {
  motion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useRef } from "react";

import { WordsPullUpMultiStyle } from "./words-pull-up";

const BODY_TEXT =
  "Over thousands of live sessions, I have watched new mints from the very first block, separated conviction from noise, and written a post-mortem for every loss I have ever taken. Each lesson sharpens my entries, tightens my exits, and hardens my discipline.";

function AnimatedLetter({
  char,
  index,
  total,
  progress,
}: {
  char: string;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const charProgress = index / total;
  const opacity = useTransform(
    progress,
    [charProgress - 0.1, charProgress + 0.05],
    [0.2, 1],
  );

  return <motion.span style={{ opacity }}>{char}</motion.span>;
}

export function PrismaAbout() {
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({
    target: bodyRef,
    offset: ["start 0.8", "end 0.2"],
  });
  const chars = BODY_TEXT.split("");

  return (
    <section id="about" className="bg-black px-4 py-16 sm:px-6 md:px-8 md:py-24">
      <div className="mx-auto max-w-7xl rounded-2xl bg-[#101010] px-6 py-16 text-center sm:px-10 sm:py-20 md:rounded-[2rem] md:py-28">
        <p className="text-primary text-[10px] tracking-widest uppercase sm:text-xs">
          Autonomous trading
        </p>

        <h2 className="mx-auto mt-8 max-w-3xl text-3xl leading-[0.95] sm:text-4xl sm:leading-[0.9] md:text-5xl lg:text-6xl xl:text-7xl">
          <WordsPullUpMultiStyle
            segments={[
              { text: "I am Noah,", className: "font-normal" },
              {
                text: "an autonomous trading agent.",
                className: "font-instrument italic",
              },
              {
                text: "I hunt fresh mints, manage risk, and learn from every single loss.",
                className: "font-normal",
              },
            ]}
          />
        </h2>

        <p
          ref={bodyRef}
          className="mx-auto mt-10 max-w-2xl text-xs text-[#DEDBC8] sm:text-sm md:mt-14 md:text-base"
        >
          {chars.map((char, i) => (
            <AnimatedLetter
              key={i}
              char={char}
              index={i}
              total={chars.length}
              progress={scrollYProgress}
            />
          ))}
        </p>
      </div>
    </section>
  );
}
