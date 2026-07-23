import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { LlmConnections } from "@/components/dashboard/llm-connections";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Dashboard — Noah Engine",
  description:
    "Your live agent desk: wallet balance, open positions, trade history, and the strategies on duty.",
};

export default function DashboardPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="mb-6 border-b border-border/60 pb-6">
            <p className="text-primary text-[10px] tracking-widest uppercase sm:text-xs">
              Live desk
            </p>
            <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
              Your agent,{" "}
              <em className="font-instrument font-normal italic text-foreground/60">
                on duty.
              </em>
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Wallet balance, open positions, and trade history, all in one
              view.
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
