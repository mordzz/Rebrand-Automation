import type { Metadata } from "next";

import { DeployShell } from "@/components/deploy/deploy-shell";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Deploy Your Agent — Noah Engine",
  description:
    "Connect your wallet, choose a character for your agent, tune its rules, and start in paper mode — all study, no spending.",
};

export default function DeployPage() {
  return (
    <>
      <div className="bg-noise pointer-events-none fixed inset-0 opacity-[0.15]" />
      {/* Ambient glow behind the panels */}
      <div
        aria-hidden
        className="pointer-events-none fixed -top-24 right-[15%] h-96 w-96 rounded-full bg-primary/10 blur-[130px]"
      />
      <SiteHeader />
      {/* No overflow-hidden: it would break the sticky character/chat
          column in DeployShell, the same way it broke the whitepaper's
          sticky TOC. The decorations above are `fixed`, so they were
          never actually being clipped by it anyway. */}
      <main className="relative flex-1">
        <div className="relative mx-auto max-w-7xl px-6 py-8 sm:px-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4 pb-6">
            <div>
              <p className="text-primary text-[10px] tracking-widest uppercase sm:text-xs">
                Deploy
              </p>
              <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
                Deploy your{" "}
                <em className="font-instrument font-normal italic text-foreground/60">
                  agent.
                </em>
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Connect your wallet, choose a face for your agent, and tune its
                trading rules. It starts in paper mode — all study, no
                spending.
              </p>
            </div>
          </div>
          <DeployShell />
        </div>
      </main>
      <SiteFooter slim />
    </>
  );
}
