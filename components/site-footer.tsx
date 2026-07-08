import Link from "next/link";

import { Separator } from "@/components/ui/separator";

export function SiteFooter({ slim = false }: { slim?: boolean }) {
  if (slim) {
    return (
      <footer className="border-t">
        <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground sm:px-6">
          <p>
            <span className="font-display font-semibold text-foreground">
              The Fable.
            </span>{" "}
            · Est. in the trenches
          </p>
          <p>Built on Solana · 400ms blocks · No sleep</p>
        </div>
      </footer>
    );
  }

  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <p className="font-display text-2xl font-semibold">The Fable.</p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-primary-foreground/70">
              A fine house of trading automation, serving the Solana trenches
              since the great memecoin rush. Machines of impeccable manners.
            </p>
          </div>
          <div>
            <p className="text-xs font-medium tracking-widest uppercase text-primary-foreground/50">
              Pages
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link
                  href="/"
                  className="text-primary-foreground/80 transition-colors hover:text-accent"
                >
                  Home
                </Link>
              </li>
              <li>
                <Link
                  href="/strategies"
                  className="text-primary-foreground/80 transition-colors hover:text-accent"
                >
                  Strategies
                </Link>
              </li>
              <li>
                <Link
                  href="/pricing"
                  className="text-primary-foreground/80 transition-colors hover:text-accent"
                >
                  Pricing
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium tracking-widest uppercase text-primary-foreground/50">
              House rules
            </p>
            <p className="mt-4 text-sm leading-relaxed text-primary-foreground/70">
              Nothing herein constitutes financial advice. The trenches are
              muddy; enter at your own peril. Your keys remain your own.
            </p>
          </div>
        </div>

        <Separator className="my-8 bg-primary-foreground/15" />

        <div className="flex flex-col items-center justify-between gap-3 text-xs text-primary-foreground/50 sm:flex-row">
          <p>Est. in the trenches · All rights reserved</p>
          <p>Built on Solana · 400ms blocks · No sleep</p>
        </div>
      </div>
    </footer>
  );
}
