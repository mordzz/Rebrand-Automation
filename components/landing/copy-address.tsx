"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Middle-truncated so both ends stay readable: the head and tail are what
 * a reader actually checks an address against, and a tail-only ellipsis
 * hides the half that distinguishes a lookalike. */
function truncate(address: string, edge = 6) {
  if (address.length <= edge * 2 + 1) return address;
  return `${address.slice(0, edge)}…${address.slice(-edge)}`;
}

export function CopyAddress({
  address,
  label,
  className = "",
}: {
  address: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The confirmation is on a timer, so it has to be cleared if the button
  // unmounts while it is still showing.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // Clipboard can be blocked by permissions or a non-secure origin.
      // Fall back to a selection-based copy rather than failing silently.
      const field = document.createElement("textarea");
      field.value = address;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try {
        document.execCommand("copy");
      } catch {
        document.body.removeChild(field);
        return;
      }
      document.body.removeChild(field);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      // The full address is in the title and the aria-label, so what a
      // screen reader and a hover both get is the value itself, not the
      // abbreviation shown for space.
      title={address}
      aria-label={`Copy contract address ${address}`}
      className={`group inline-flex max-w-full items-center gap-2 rounded-full border border-black/15 bg-black/[0.04] py-1.5 pr-2 pl-3.5 transition-colors hover:border-black/30 hover:bg-black/[0.07] ${className}`}
    >
      {label && (
        <span className="shrink-0 text-[10px] font-medium tracking-widest text-black/45 uppercase">
          {label}
        </span>
      )}

      {/* Truncated below sm, full address from sm up: the whole string fits
          once there is room, and an operator verifying a contract should
          not have to hover to see it. */}
      <span className="font-mono text-[11px] text-black/70 sm:hidden">
        {truncate(address)}
      </span>
      <span className="hidden truncate font-mono text-[11px] text-black/70 sm:inline">
        {address}
      </span>

      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-black/10 text-black/60 transition-colors group-hover:bg-black/20 group-hover:text-black">
        {copied ? (
          <Check className="size-3" aria-hidden />
        ) : (
          <Copy className="size-3" aria-hidden />
        )}
      </span>

      {/* Announced to assistive tech without moving anything on screen. */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Address copied" : ""}
      </span>
    </button>
  );
}
