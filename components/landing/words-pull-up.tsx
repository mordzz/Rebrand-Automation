"use client";

import { motion, useInView } from "motion/react";
import { Fragment, useRef, type CSSProperties } from "react";

/** Per-word slide-up reveal shared by every Prisma heading. */
const WORD_STAGGER = 0.08;
const PULL_UP_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function WordsPullUp({
  text,
  className = "",
  style,
  showAsterisk = false,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
  /** Superscript * hung off the last character of the final word. */
  showAsterisk?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const words = text.split(" ");

  return (
    <div ref={ref} className={className} style={style}>
      {words.map((word, i) => (
        <Fragment key={`${word}-${i}`}>
          <motion.span
            className="relative inline-block"
            initial={{ y: 20, opacity: 0 }}
            animate={inView ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
            transition={{
              delay: i * WORD_STAGGER,
              duration: 0.6,
              ease: PULL_UP_EASE,
            }}
          >
            {word}
            {showAsterisk && i === words.length - 1 && (
              <span className="absolute top-[0.65em] -right-[0.3em] text-[0.31em]">
                *
              </span>
            )}
          </motion.span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </div>
  );
}

export function WordsPullUpMultiStyle({
  segments,
  className = "",
}: {
  segments: { text: string; className?: string }[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const words = segments.flatMap((segment) =>
    segment.text
      .split(" ")
      .map((word) => ({ word, className: segment.className ?? "" })),
  );

  return (
    <div
      ref={ref}
      className={`inline-flex flex-wrap justify-center ${className}`}
    >
      {words.map(({ word, className: wordClass }, i) => (
        <motion.span
          key={`${word}-${i}`}
          className={`inline-block ${
            i < words.length - 1 ? "mr-[0.25em] " : ""
          }${wordClass}`}
          initial={{ y: 20, opacity: 0 }}
          animate={inView ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
          transition={{
            delay: i * WORD_STAGGER,
            duration: 0.6,
            ease: PULL_UP_EASE,
          }}
        >
          {word}
        </motion.span>
      ))}
    </div>
  );
}
