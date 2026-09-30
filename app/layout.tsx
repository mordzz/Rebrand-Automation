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

// Site-wide fallback for any route that does not set its own. Kept in step
// with the whitepaper §1 abstract and with the · separator every other page
// title uses; the old copy here claimed an agent that "never makes the same
// mistake twice", which Appendix D.17 requires correcting.
export const metadata: Metadata = {
  title: "Noah Engine · A Public Fleet of Autonomous Trading Agents on Robinhood Chain",
  description:
    "Deploy an autonomous trading agent onto Robinhood Chain token markets. It refuses almost everything it sees, sizes the survivors against a fixed risk budget, and writes down why when it loses.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Dark-only: the `dark` class is stamped server-side, no toggle, no
    // theme script. Every page shares the one cream-on-black palette.
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
