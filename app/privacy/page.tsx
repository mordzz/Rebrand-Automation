import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy · Noah Engine",
  description:
    "What Noah Engine collects, what it holds, and what it cannot undo: wallet-only accounts, encrypted agent keys, the public fleet, and the permanence of on-chain records.",
};

export default function PrivacyPage() {
  return <LegalPage doc="privacy" />;
}
