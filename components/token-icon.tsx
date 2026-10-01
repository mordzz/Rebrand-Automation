"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A token's logo, falling back to its ticker initials.
 *
 * Two reasons the fallback is not optional: sources hand us an empty logo
 * for the very freshest mints (GMGN needs a moment to cache the image -
 * measured at roughly 1 in 60), and the URLs that do arrive point at
 * arbitrary IPFS gateways and CDNs that fail often enough to matter.
 *
 * A plain <img> rather than next/image on purpose: these hosts are
 * per-token and unbounded, so an allowlist is not something we can
 * maintain ahead of time.
 */
export function TokenIcon({
  src,
  symbol,
  className,
}: {
  src: string | null | undefined;
  symbol: string | null | undefined;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  // A recycled component instance (list re-render, pagination) must retry
  // the new URL rather than stay stuck on a previous token's failure.
  // Reset during render - React's documented "adjust state on prop change"
  // pattern - rather than in an effect, which would cost an extra pass.
  const [lastSrc, setLastSrc] = useState(src);
  if (src !== lastSrc) {
    setLastSrc(src);
    setFailed(false);
  }

  const base = cn("size-9 shrink-0 rounded-full bg-secondary", className);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn(base, "object-cover")}
      />
    );
  }

  return (
    <span
      className={cn(
        base,
        "text-primary/70 flex items-center justify-center text-[0.7rem] font-semibold"
      )}
    >
      {(symbol ?? "?").replace(/^\$+/, "").slice(0, 3).toUpperCase()}
    </span>
  );
}
