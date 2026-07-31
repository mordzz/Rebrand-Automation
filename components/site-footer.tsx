import Link from "next/link";

import { Logo } from "@/components/logo";
import { XIcon } from "@/components/social-icons";

/** The one official account. Shown with its handle rather than as a bare
 * icon: a public fleet attracts impersonation (whitepaper §14.6), and a
 * reader can only check an account against the real one if the real one is
 * written out somewhere they can read it. */
const X_URL = "https://x.com/NoahengineX";
const X_HANDLE = "@NoahengineX";

const PAGE_LINKS = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/#manifest", label: "The Manifest" },
  { href: "/#strategies", label: "Instincts" },
  { href: "/alpha", label: "Alpha" },
  { href: "/atelier", label: "The fleet" },
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
            {/* Icon only here: this bar is every non-landing page's footer
                and has no room for the handle, so the label carries it. */}
            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Noah Engine on X, ${X_HANDLE}`}
              className="shrink-0 transition-colors hover:text-foreground"
            >
              <XIcon size={13} />
            </a>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <span className="hidden sm:inline">
              Refuse by default · Rules before positions · Rank survival
            </span>
          </div>
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
              A public fleet of autonomous trading agents on Solana. They refuse
              almost everything they see, size the survivors against a fixed
              risk budget, and write down why when they lose.
            </p>

            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Noah Engine on X, ${X_HANDLE}`}
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <XIcon size={14} />
              {X_HANDLE}
            </a>
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
            {/* Whitepaper §12.1 / §22: exits are best-effort, never a floor
                under losses, and the seed-phrase line is the one operators
                are most often defrauded on. */}
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              Memecoins are volatile and can go to zero. Exits are rule-based
              and best-effort, not guaranteed stops, and nothing here places a
              floor under losses. Trading software, not advice, and never a
              promise of profit.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Noah never asks for a seed phrase or private key, never messages
              you first, and never requests a deposit to an address. There is no
              Noah token.
            </p>
          </div>
        </div>

        {/* Legal sits on the bottom rule rather than in the Pages column:
            it belongs with the copyright line, and mixing it into the
            product navigation buries it. */}
        <div className="mt-14 flex flex-col gap-4 border-t border-border pt-6 text-xs text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p>Est. 2026 · All rights reserved</p>
            <Link
              href="/terms"
              className="transition-colors hover:text-foreground"
            >
              Terms of Service
            </Link>
            <Link
              href="/privacy"
              className="transition-colors hover:text-foreground"
            >
              Privacy Policy
            </Link>
          </div>
          <p>Refuse by default · Rules before positions · Rank survival</p>
        </div>
      </div>
    </footer>
  );
}
