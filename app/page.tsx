import type { Metadata } from "next";
import type { CSSProperties } from "react";

import { PrismaAbout } from "@/components/landing/prisma-about";
import { PrismaFeatures } from "@/components/landing/prisma-features";
import { PrismaHero } from "@/components/landing/prisma-hero";
import { PrismaHowItWorks } from "@/components/landing/prisma-how-it-works";
import { PrismaPricing } from "@/components/landing/prisma-pricing";
import { PrismaStrategies } from "@/components/landing/prisma-strategies";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Noah Engine · Autonomous Meme-Coin Trading",
  description:
    "An autonomous AI agent that trades meme coins around the clock: sniping new mints, managing risk, and learning from every loss while you sleep.",
};

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
      <PrismaFeatures />
      <PrismaStrategies />
      <PrismaHowItWorks />
      <PrismaPricing />
      <SiteFooter />
    </main>
  );
}
