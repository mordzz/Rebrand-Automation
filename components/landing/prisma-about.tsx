"use client";

import {
  motion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useRef } from "react";

import { WordsPullUpMultiStyle } from "./words-pull-up";

/** Whitepaper §3. Deliberately makes no claim about sessions run or
 * results achieved: the document publishes methodology, never projections
 * or observed performance (Design Principle 8). */
const BODY_TEXT =
  "Solana produces a flood of new tokens every day. The overwhelming majority are worthless, and a meaningful share are built to take your money. Finding tokens was never the problem. The problem is that almost everything has to be turned away. An agent that buys enthusiastically is trivial to write; an agent that refuses correctly, thousands of times a day, is the hard part, and it is the part that decides whether a wallet survives.";

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
          Why Noah
        </p>

        <h2 className="mx-auto mt-8 max-w-3xl text-3xl leading-[0.95] sm:text-4xl sm:leading-[0.9] md:text-5xl lg:text-6xl xl:text-7xl">
          <WordsPullUpMultiStyle
            segments={[
              { text: "Named for the discipline of the ark:", className: "font-normal" },
              {
                text: "build the hull first, fix the admission criteria before the water rises,",
                className: "font-instrument italic",
              },
              {
                text: "let almost nothing aboard.",
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

        <p className="font-instrument mx-auto mt-10 max-w-xl text-base italic text-gray-400 sm:text-lg md:text-xl">
          An ark is not judged by how much it collected, but by whether it was
          still afloat when the water went down.
        </p>
      </div>
    </section>
  );
}
