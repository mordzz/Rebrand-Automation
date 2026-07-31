import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service · Noah Engine",
  description:
    "The terms for deploying an agent on Noah Engine: what the software is and is not, the custody model, best-effort exits, the one-time SOL fee, and the limits of every guarantee.",
};

export default function TermsPage() {
  return <LegalPage doc="terms" />;
}
