import Link from "next/link";

import { Logo } from "@/components/logo";

const PAGE_LINKS = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/#strategies", label: "Autonomous" },
  { href: "/alpha", label: "Alpha" },
  { href: "/atelier", label: "Atelier" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/deploy", label: "Deploy agent" },
  { href: "/whitepaper", label: "Whitepaper" },
];

export function SiteFooter({ slim = false }: { slim?: boolean }) {
  if (slim) {
    return (
      <footer className="bg-background">
        <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground sm:px-6">
          <div className="flex items-center gap-3">
            <p className="flex items-center gap-1.5">
              <Logo className="size-4 shrink-0 text-foreground" />
              <span>
                <span className="text-sm font-bold text-foreground">
                  Noah Engine
                </span>{" "}
                · Est. 2026
              </span>
            </p>
          </div>
          <p>Autonomous · Risk-guarded · Always learning</p>
        </div>
      </footer>
    );
  }

  return (
    <footer className="bg-background px-4 pb-4 sm:px-6 md:px-8 md:pb-6">
      <div className="mx-auto max-w-7xl rounded-2xl bg-card px-6 py-14 sm:px-10 md:rounded-[2rem]">
        <div className="grid gap-12 md:grid-cols-3">
          <div>
            <p className="flex items-center gap-2 text-3xl font-medium tracking-tight text-foreground">
              <Logo className="size-7 shrink-0 text-foreground" />
              <span>
                Noah{" "}
                <em className="font-instrument italic text-foreground/60">
                  Engine
                </em>
                <span className="align-super text-[0.5em]">*</span>
              </span>
            </p>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              An autonomous AI agent that trades meme coins around the clock:
              sniping new mints, managing risk, and learning from every loss.
            </p>
          </div>
          <div>
            <p className="text-primary text-[10px] tracking-widest uppercase sm:text-xs">
              Pages
            </p>
            {/* Two columns: a single stack of eight runs far taller than the
                two prose columns beside it and leaves the footer lopsided. */}
            <ul className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {PAGE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-primary text-[10px] tracking-widest uppercase sm:text-xs">
              Fine print
            </p>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              Meme coins are volatile and can go to zero. Noah manages risk
              with hard stops and dry-run defaults; it never promises profit.
              Your keys, your trades, your call.
            </p>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground/70 sm:flex-row">
          <p>Est. 2026 · All rights reserved</p>
          <p>Autonomous · Risk-guarded · Always learning</p>
        </div>
      </div>
    </footer>
  );
}
