import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { LlmConnections } from "@/components/dashboard/llm-connections";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Dashboard — The Fable",
  description:
    "Your trading desk at The Fable: wallet balance, open positions, trade history, and the automatons on duty.",
};

export default function DashboardPage() {
  return (
    <>
      <SiteHeader compact />
      <main className="flex-1">
        <div className="max-w-full px-4 py-6 sm:px-6">
          <div className="mb-5">
            <h1 className="font-display text-2xl font-medium">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The house automatons at your service — balances, positions, and
              the ledger, all in one parlour.
            </p>
          </div>
          <DashboardShell />
          <LlmConnections />
        </div>
      </main>
      <SiteFooter slim />
    </>
  );
}
