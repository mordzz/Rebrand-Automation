import { getWhitepaperToc } from "@/lib/whitepaper";

/** Top-level sections + appendices only (27 entries) — the full TOC
 * including every subsection runs past 70 entries, taller than the
 * viewport on any normal screen, which forced an internal scrollbar and
 * made the sidebar read as cluttered rather than a clean fixed rail.
 * Subsections stay reachable by reading into a section normally. A
 * generous max-height + scroll remains as a fallback for very short
 * viewports, but at this length it shouldn't engage in practice. */
export function WhitepaperToc() {
  const entries = getWhitepaperToc().filter((entry) => entry.level === 2);

  return (
    <nav
      aria-label="Table of contents"
      className="sticky top-24 hidden max-h-[calc(100vh-7rem)] w-56 shrink-0 overflow-y-auto lg:block"
    >
      <p className="text-[0.65rem] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        Contents
      </p>
      <ul className="mt-2.5 border-l border-white/10">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className="block border-l border-transparent py-[3px] pl-3 text-[0.7rem] leading-tight font-medium text-foreground/70 transition-colors hover:border-primary/50 hover:text-primary"
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
