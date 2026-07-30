"use client";

import { ChevronDown, LayoutDashboard, type LucideIcon, Rocket, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { AuthButton } from "@/components/auth-button";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type NavLink = { href: string; label: string; icon?: LucideIcon };

const NAV_LINKS: NavLink[] = [
  { href: "/#about", label: "Our story" },
  { href: "/#strategies", label: "Autonomous" },
  { href: "/alpha", label: "Alpha" },
  { href: "/whitepaper", label: "Whitepaper" },
  { href: "/#pricing", label: "Pricing" },
];

const AGENT_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/deploy", label: "Deploy Agent", icon: Rocket },
  { href: "/atelier", label: "Atelier", icon: Users },
];

const MOBILE_LINKS = [NAV_LINKS[0], ...AGENT_LINKS, ...NAV_LINKS.slice(1)];

/** The one navbar — the same black pill everywhere, hero included, so
 * every page reads identically. Keep all nav changes here so every page
 * stays in step.
 *
 * The full link row appears at `lg`, not `md`: six links plus the brand
 * and the auth button need ~730px, which at 768px leaves the pill almost
 * touching both viewport edges and reading as a full-width bar rather
 * than a floating pill. Tablets get the collapsed menu instead. */
export function NavPill() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAgentActive = AGENT_LINKS.some((link) => link.href === pathname);

  const openAgentMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setAgentOpen(true);
  };
  const scheduleCloseAgentMenu = () => {
    closeTimer.current = setTimeout(() => setAgentOpen(false), 150);
  };

  return (
    <div className="rounded-b-2xl border border-t-0 border-white/10 bg-black px-4 py-2.5 md:rounded-b-3xl md:px-6 md:py-3">
      <div className="flex items-center gap-6 lg:gap-8">
        <Link
          href="/"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 whitespace-nowrap text-sm font-bold tracking-tight"
          style={{ color: "#E1E0CC" }}
        >
          <Logo className="size-5" />
          Noah Engine<span className="align-super text-[0.6em]">*</span>
        </Link>

        <nav className="hidden lg:block">
          <ul className="flex items-center gap-4 lg:gap-6">
            <li>
              <Link
                href={NAV_LINKS[0].href}
                className={cn(
                  "prisma-nav-link whitespace-nowrap text-sm",
                  pathname === NAV_LINKS[0].href && "!text-[#E1E0CC]"
                )}
              >
                {NAV_LINKS[0].label}
              </Link>
            </li>

            <li
              className="relative"
              onMouseEnter={openAgentMenu}
              onMouseLeave={scheduleCloseAgentMenu}
            >
              <button
                type="button"
                onClick={() => setAgentOpen((v) => !v)}
                aria-expanded={agentOpen}
                className={cn(
                  "prisma-nav-link flex items-center gap-1 whitespace-nowrap text-sm",
                  isAgentActive && "!text-[#E1E0CC]"
                )}
              >
                Noah Agent
                <ChevronDown
                  size={13}
                  className={cn(
                    "transition-transform duration-200",
                    agentOpen && "rotate-180"
                  )}
                />
              </button>

              <AnimatePresence>
                {agentOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ duration: 0.16, ease: EASE }}
                    className="absolute top-full left-1/2 z-50 mt-3 w-48 -translate-x-1/2 rounded-xl border border-white/10 bg-black p-1.5 shadow-xl shadow-black/40"
                  >
                    {AGENT_LINKS.map((link) => {
                      const Icon = link.icon;
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setAgentOpen(false)}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-white/70 transition-colors hover:bg-white/5 hover:text-[#E1E0CC]",
                            pathname === link.href && "text-[#E1E0CC]"
                          )}
                        >
                          {Icon && <Icon size={15} className="shrink-0" />}
                          {link.label}
                        </Link>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </li>

            {NAV_LINKS.slice(1).map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={cn(
                    "prisma-nav-link whitespace-nowrap text-sm",
                    pathname === link.href && "!text-[#E1E0CC]"
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden lg:block">
            <AuthButton />
          </div>
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="prisma-nav-link flex size-8 items-center justify-center text-base lg:hidden"
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {open && (
        <nav className="pt-3 pb-2 lg:hidden">
          <ul className="flex flex-col">
            {MOBILE_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="prisma-nav-link flex items-center gap-2.5 py-2 text-xs"
                  >
                    {Icon && <Icon size={14} className="opacity-70" />}
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 border-t border-white/10 pt-2 pb-1">
            <AuthButton inline />
          </div>
        </nav>
      )}
    </div>
  );
}
