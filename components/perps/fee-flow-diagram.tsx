"use client";

import { motion } from "motion/react";

import type { FeeSplitConfig } from "@/lib/perps/perpspad-types";
import { useFeeSplit } from "./use-fee-split";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* Diagram geometry, in viewBox units. Pulled out as named constants
   because the ribbon maths below is unreadable with raw numbers inline. */
const VB_W = 200;
const VB_H = 96;
const X_SRC_EDGE = 48; // right edge of the source node - where ribbons start
const X_DST_EDGE = 124; // left edge of the destination cards - where they end
const SRC_CY = 48; // source node's vertical centre
const BAND = 26; // total ribbon thickness representing 100% of fees
const DST_CY = [16, 48, 80]; // destination card centres, top to bottom
const CARD_H = 26;

/** One Sankey ribbon: leaves the source stacked at `srcTop..srcBottom`,
 * lands centred on `dstCy` with thickness `w`. Thickness is proportional
 * to the percentage, so the 50% leg is visibly twice the 25% legs -
 * the split is readable from the shape alone, not just the labels. */
function ribbon(srcTop: number, srcBottom: number, dstCy: number, w: number) {
  const dTop = dstCy - w / 2;
  const dBot = dstCy + w / 2;
  const cx = (X_SRC_EDGE + X_DST_EDGE) / 2;
  return [
    `M ${X_SRC_EDGE} ${srcTop}`,
    `C ${cx} ${srcTop}, ${cx} ${dTop}, ${X_DST_EDGE} ${dTop}`,
    `L ${X_DST_EDGE} ${dBot}`,
    `C ${cx} ${dBot}, ${cx} ${srcBottom}, ${X_SRC_EDGE} ${srcBottom}`,
    "Z",
  ].join(" ");
}

/** Every percentage here (the diagram and the detail cards below) is
 * derived from one fetched FeeSplitConfig - this used to be three
 * separately-hardcoded copies of "50%/25%/25%" (this file, the
 * create-token preview panel, and lib/perps/perpspad-types.ts's own
 * never-imported DEFAULT_FEE_SPLIT), which is exactly the kind of
 * duplication that lets the real config drift out of sync with what the
 * UI claims. See lib/perps/fee-split.ts#getFeeSplitConfig. */
function buildLegs(split: FeeSplitConfig) {
  const legs = [
    {
      id: "collateral",
      pct: split.collateralTopUp,
      title: "Collateral Top-up",
      short: "Collateral",
      color: "#DEDBC8",
      desc: "Strengthens the perp position, reducing liquidation risk and increasing effective backing per token.",
    },
    {
      id: "token-burn",
      pct: split.tokenBuybackBurn,
      title: "Token Buyback & Burn",
      short: "Token Burn",
      color: "#5ed29c",
      desc: "Buys the token back from its own liquidity pool and burns it, creating deflationary pressure.",
    },
    {
      id: "gov-burn",
      pct: split.governanceBuybackBurn,
      title: "$PERPSPAD Burn",
      short: "Gov Burn",
      color: "#e2603f",
      desc: "Buys the governance token and burns it, aligning protocol incentives across all launched tokens.",
    },
  ];

  // Stack the ribbons down the source node's right edge in order, each
  // occupying a slice of BAND proportional to its share.
  const total = legs.reduce((s, l) => s + l.pct, 0) || 100;
  let cursor = SRC_CY - BAND / 2;
  return legs.map((leg, i) => {
    const thickness = (leg.pct / total) * BAND;
    const srcTop = cursor;
    const srcBottom = cursor + thickness;
    cursor = srcBottom;
    return {
      ...leg,
      thickness,
      path: ribbon(srcTop, srcBottom, DST_CY[i], thickness),
      cy: DST_CY[i],
    };
  });
}

export function FeeFlowDiagram() {
  const feeSplit = useFeeSplit();
  const legs = buildLegs(feeSplit);

  return (
    <section className="pb-20">
      <div className="max-w-2xl">
        <p className="text-primary text-[10px] tracking-[0.3em] uppercase sm:text-xs">
          Fee Economics
        </p>
        <h2 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">
          Where every basis point{" "}
          <em className="font-instrument font-normal italic text-foreground/60">
            goes.
          </em>
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Every swap on the token&apos;s Meteora pool generates trading fees.
          The keeper bot collects and distributes them automatically, on a
          fixed split enforced on-chain.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.7, ease: EASE }}
        className="mt-8 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02]"
      >
        {/* Sankey flow */}
        <div className="px-4 py-6 sm:px-8 sm:py-8">
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="w-full"
            role="img"
            aria-label={`Trading fees split ${legs.map((l) => `${l.pct}% ${l.title}`).join(", ")}`}
          >
            <defs>
              {legs.map((leg) => (
                <linearGradient
                  key={leg.id}
                  id={`grad-${leg.id}`}
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="0"
                >
                  <stop offset="0%" stopColor={leg.color} stopOpacity="0.08" />
                  <stop offset="100%" stopColor={leg.color} stopOpacity="0.32" />
                </linearGradient>
              ))}
            </defs>

            {/* Ribbons, drawn before the nodes so the cards sit on top */}
            {legs.map((leg, i) => (
              <motion.path
                key={leg.id}
                d={leg.path}
                fill={`url(#grad-${leg.id})`}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: 0.25 + i * 0.12, ease: EASE }}
              />
            ))}

            {/* Source node */}
            <motion.g
              initial={{ opacity: 0, x: -6 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <rect
                x="4"
                y={SRC_CY - 15}
                width="44"
                height="30"
                rx="6"
                fill="#DEDBC8"
                fillOpacity="0.06"
                stroke="#DEDBC8"
                strokeOpacity="0.28"
                strokeWidth="0.5"
              />
              <text
                x="26"
                y={SRC_CY - 3}
                textAnchor="middle"
                fill="#DEDBC8"
                fontSize="5.5"
                fontWeight="600"
              >
                Trading Fees
              </text>
              <text
                x="26"
                y={SRC_CY + 6}
                textAnchor="middle"
                fill="#DEDBC8"
                fillOpacity="0.55"
                fontSize="4.5"
              >
                Meteora pool
              </text>
            </motion.g>

            {/* Destination cards */}
            {legs.map((leg, i) => (
              <motion.g
                key={leg.id}
                initial={{ opacity: 0, x: 6 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.5 + i * 0.12, ease: EASE }}
              >
                <rect
                  x={X_DST_EDGE}
                  y={leg.cy - CARD_H / 2}
                  width={VB_W - X_DST_EDGE - 4}
                  height={CARD_H}
                  rx="6"
                  fill={leg.color}
                  fillOpacity="0.07"
                  stroke={leg.color}
                  strokeOpacity="0.3"
                  strokeWidth="0.5"
                />
                <text
                  x={X_DST_EDGE + 8}
                  y={leg.cy - 1}
                  fill={leg.color}
                  fontSize="8"
                  fontWeight="700"
                >
                  {leg.pct}%
                </text>
                <text
                  x={X_DST_EDGE + 8}
                  y={leg.cy + 8}
                  fill={leg.color}
                  fillOpacity="0.7"
                  fontSize="4.8"
                >
                  {leg.short}
                </text>
              </motion.g>
            ))}
          </svg>
        </div>

        {/* Detail cards */}
        <div className="grid gap-px border-t border-white/6 bg-white/6 sm:grid-cols-3">
          {legs.map((leg) => (
            <div key={leg.id} className="bg-background p-5">
              <div className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: leg.color }}
                />
                <span
                  className="font-mono text-lg font-bold tabular-nums"
                  style={{ color: leg.color }}
                >
                  {leg.pct}%
                </span>
              </div>
              <h4 className="mt-2 text-xs font-semibold">{leg.title}</h4>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {leg.desc}
              </p>
            </div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
