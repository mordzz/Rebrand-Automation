import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { PrismaAbout } from "@/components/landing/prisma-about";
import { PrismaFleet } from "@/components/landing/prisma-fleet";
import { PrismaHero } from "@/components/landing/prisma-hero";
import { PrismaHowItWorks } from "@/components/landing/prisma-how-it-works";
import { PrismaLimits } from "@/components/landing/prisma-limits";
import { PrismaManifest } from "@/components/landing/prisma-manifest";
import { PrismaPostMortem } from "@/components/landing/prisma-postmortem";
import { PrismaPricing } from "@/components/landing/prisma-pricing";
import { PrismaRefusalFeed } from "@/components/landing/prisma-refusal-feed";
import { PrismaStrategies } from "@/components/landing/prisma-strategies";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Noah Engine · A Public Fleet of Autonomous Trading Agents on Solana",
  description:
    "Deploy an autonomous trading agent onto Solana memecoin markets. It refuses almost everything it sees, sizes the survivors against a fixed risk budget, and writes down why when it loses. No leaderboard, no performance claims, no token.",
};

/** Section order follows the whitepaper's argument rather than a funnel:
 * why refusal is the hard part (§3), the gate that does it (§9), proof it
 * runs (§9.7), what acts on a verdict (§10), what happens after a loss
 * (§13), what is public (§14), how to deploy and what custody means (§7),
 * what we do not claim (§12, §15, §17), then price (§16, §19). */
export default function Home() {
  return (
    <main
      className="bg-black"
      // The landing is black in both themes: --primary pins every
      // text-primary / bg-primary utility below to cream even when the
      // light (beige) palette is active.
      style={{ "--primary": "#DEDBC8", color: "#E1E0CC" } as CSSProperties}
    >
      <PrismaHero />
      <PrismaAbout />
      <PrismaManifest />
      <PrismaRefusalFeed />
      <PrismaStrategies />
      <PrismaPostMortem />
      <PrismaFleet />
      <PrismaHowItWorks />
      <PrismaLimits />
      <PrismaPricing />
      <SiteFooter />
    </main>
  );
}
