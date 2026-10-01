"use client";

import { ChevronDown, LogOut, type LucideIcon, Rocket, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import { PRIVY_APP_ID } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Account-scoped destinations, deliberately distinct from the navbar's
 * "Noah Agent" menu: that one is the product's own surfaces, this one is
 * "your agent" - where you tune it and where the public sees it. */
const MY_AGENT_LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/deploy", label: "Agent desk", icon: Rocket },
  { href: "/atelier", label: "View in fleet", icon: Users },
];

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

const ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-white/70 transition-colors hover:bg-white/5 hover:text-[#E1E0CC]";

/** Rendered only when a Privy app id is configured - usePrivy() throws
 * outside its provider, hence the split from AuthButton below. */
function AuthButtonInner({ inline }: { inline: boolean }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const address = user?.wallet?.address;

  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  async function handleLogout() {
    setOpen(false);
    await logout();
    router.push("/");
  }

  if (!ready) {
    return (
      <Button size="sm" className="rounded-full px-3.5" disabled>
        …
      </Button>
    );
  }

  if (!authenticated) {
    return (
      <Button size="sm" className="rounded-full px-3.5" onClick={() => login()}>
        Login
      </Button>
    );
  }

  /* Inside the collapsed mobile menu the sheet is already open, so a
     second nested dropdown would just add a tap for no reason - the same
     items render inline instead. */
  if (inline) {
    return (
      <div className="flex flex-col gap-0.5">
        {address && (
          <p className="px-3 pb-1 font-mono text-[0.7rem] text-white/40">
            {shortAddress(address)}
          </p>
        )}
        {MY_AGENT_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(ITEM_CLASS, pathname === link.href && "text-[#E1E0CC]")}
          >
            <link.icon size={15} className="shrink-0" />
            {link.label}
          </Link>
        ))}
        <button type="button" onClick={handleLogout} className={cn(ITEM_CLASS, "text-left")}>
          <LogOut size={15} className="shrink-0" />
          Log out
        </button>
      </div>
    );
  }

  /* No active-route highlight on the trigger itself, unlike "Noah Agent":
     this one is a filled primary button, already at maximum contrast. */
  return (
    <div className="relative" onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
      <Button
        size="sm"
        aria-expanded={open}
        className="rounded-full px-3.5"
        onClick={() => setOpen((v) => !v)}
      >
        My Agent
        <ChevronDown
          size={13}
          className={cn("ml-1 transition-transform duration-200", open && "rotate-180")}
        />
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: EASE }}
            /* Right-anchored, unlike the centred "Noah Agent" menu: this
               trigger sits at the pill's right edge, so a centred panel
               would hang off it. */
            className="absolute top-full right-0 z-50 mt-3 w-52 rounded-xl border border-white/10 bg-black p-1.5 shadow-xl shadow-black/40"
          >
            {address && (
              <p className="px-3 pt-1 pb-2 font-mono text-[0.7rem] text-white/40">
                {shortAddress(address)}
              </p>
            )}

            {MY_AGENT_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={cn(ITEM_CLASS, pathname === link.href && "text-[#E1E0CC]")}
              >
                <link.icon size={15} className="shrink-0" />
                {link.label}
              </Link>
            ))}

            <div className="my-1 h-px bg-white/10" />

            <button type="button" onClick={handleLogout} className={cn(ITEM_CLASS, "text-left")}>
              <LogOut size={15} className="shrink-0" />
              Log out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AuthButton({ inline = false }: { inline?: boolean } = {}) {
  if (!PRIVY_APP_ID) {
    // No Privy app configured yet - route to /deploy, which explains setup.
    return (
      <Button
        size="sm"
        className="rounded-full px-3.5"
        nativeButton={false}
        render={<Link href="/deploy" />}
      >
        Login
      </Button>
    );
  }
  return <AuthButtonInner inline={inline} />;
}
