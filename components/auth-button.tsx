"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

import { PRIVY_APP_ID } from "@/components/providers";
import { Button } from "@/components/ui/button";

function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Rendered only when a Privy app id is configured — usePrivy() throws
 * outside its provider, hence the split from AuthButton below. */
function AuthButtonInner() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const router = useRouter();
  const address = user?.wallet?.address;

  async function handleLogout() {
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

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        className="rounded-full px-3.5"
        nativeButton={false}
        render={<Link href="/deploy" />}
      >
        My Agent
      </Button>
      {address && (
        <button
          type="button"
          onClick={handleLogout}
          title="Log out"
          className="flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-accent/50 hover:text-accent"
        >
          {shortAddress(address)}
          <LogOut className="size-3" />
        </button>
      )}
    </div>
  );
}

export function AuthButton() {
  if (!PRIVY_APP_ID) {
    // No Privy app configured yet — route to /deploy, which explains setup.
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
  return <AuthButtonInner />;
}
