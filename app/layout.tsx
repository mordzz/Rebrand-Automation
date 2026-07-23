import type { Metadata } from "next";
import { Almarai, Instrument_Serif } from "next/font/google";
import "./globals.css";

import { Providers } from "@/components/providers";

const displayFont = Instrument_Serif({
  variable: "--font-display",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const bodyFont = Almarai({
  variable: "--font-body",
  weight: ["300", "400", "700", "800"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Noah Engine — Autonomous Meme-Coin Trading",
  description:
    "An autonomous AI agent that trades meme coins around the clock — sniping new mints, managing risk, and learning from every loss while you sleep.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Dark-only: the `dark` class is stamped server-side, no toggle, no
    // theme script — every page shares the one cream-on-black palette.
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
