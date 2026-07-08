"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/strategies", label: "Strategies" },
  { href: "/pricing", label: "Pricing" },
  { href: "/dashboard", label: "Dashboard" },
];

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b bg-background/90 backdrop-blur">
      <div
        className={cn(
          "mx-auto flex items-center justify-between px-4 sm:px-6",
          compact ? "h-12 max-w-full" : "h-16 max-w-6xl"
        )}
      >
        <Link
          href="/"
          className="flex items-baseline gap-2.5"
          onClick={() => setOpen(false)}
        >
          <span
            className={cn(
              "font-display font-semibold tracking-tight",
              compact ? "text-base" : "text-xl"
            )}
          >
            The Fable.
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-md font-medium transition-colors hover:text-accent",
                compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
                pathname === link.href
                  ? "text-accent"
                  : "text-muted-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
          <Button
            size={compact ? "sm" : "default"}
            nativeButton={false}
            render={<Link href="/pricing" />}
            className="ml-3"
          >
            Get started
          </Button>
        </nav>

        <button
          type="button"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex size-9 items-center justify-center rounded-md border text-lg md:hidden"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open && (
        <nav className="flex flex-col border-t md:hidden">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={cn(
                "border-b border-border px-6 py-4 text-sm font-medium",
                pathname === link.href
                  ? "bg-secondary text-accent"
                  : "text-muted-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
