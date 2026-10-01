"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type TocEntry = { id: string; text: string };

/** Top-level sections + appendices only (27 entries) - the full TOC
 * including every subsection runs past 70 entries, taller than the
 * viewport on any normal screen, which forced an internal scrollbar and
 * made the sidebar read as cluttered rather than a clean fixed rail.
 * Subsections stay reachable by reading into a section normally.
 *
 * Entries are passed in rather than read here: tracking reading position
 * makes this a client component, and the source markdown is read off disk. */
export function WhitepaperToc({ entries }: { entries: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  /* Which section is being read, and how far through the document. Both
     derive from scroll position so they share one listener. Without this a
     27-entry rail gives no answer to "where am I" in a document this long. */
  useEffect(() => {
    const headings = entries
      .map((e) => document.getElementById(e.id))
      .filter((el): el is HTMLElement => el != null);

    function update() {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setProgress(scrollable > 0 ? Math.min(1, doc.scrollTop / scrollable) : 0);

      /* The last heading above the reading line, not the topmost visible
         one: a section taller than the viewport has no heading on screen
         at all, and an intersection-based check would report nothing and
         blank the rail while you are still reading that section. */
      const line = doc.clientHeight * 0.25;
      let current: string | null = headings[0]?.id ?? null;
      for (const el of headings) {
        /* Viewport-relative, deliberately. offsetTop is measured from the
           nearest positioned ancestor, which here is the content card, not
           the document, so comparing it against scrollTop put the marker
           several sections behind where the reader actually was. */
        if (el.getBoundingClientRect().top <= line) current = el.id;
        else break;
      }
      setActiveId(current);
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [entries]);

  // Keep the active entry in view when the rail itself has to scroll.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    <nav
      aria-label="Table of contents"
      className="sticky top-24 hidden max-h-[calc(100vh-8rem)] w-60 shrink-0 flex-col lg:flex"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.65rem] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
          Contents
        </p>
        <span className="text-[0.65rem] tabular-nums text-muted-foreground/60">
          {Math.round(progress * 100)}%
        </span>
      </div>

      <div className="mt-2 h-px w-full bg-white/10">
        <div
          className="h-px bg-primary/70 transition-[width] duration-150"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <ul className="mt-3 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {entries.map((entry) => {
          const isActive = entry.id === activeId;
          // Appendices get air, so the numbered spec reads as one block and
          // the reference material as another.
          const isFirstAppendix = entry.text.startsWith("Appendix A");
          return (
            <li
              key={entry.id}
              className={cn(isFirstAppendix && "mt-3 border-t border-white/10 pt-3")}
            >
              <a
                ref={isActive ? activeRef : undefined}
                href={`#${entry.id}`}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "block border-l py-1 pl-3 text-[0.72rem] leading-tight transition-colors",
                  isActive
                    ? "border-primary font-medium text-primary"
                    : "border-white/10 text-foreground/55 hover:border-white/40 hover:text-foreground"
                )}
              >
                {entry.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
