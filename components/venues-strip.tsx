import { Reveal } from "@/components/reveal";

const VENUES = [
  { name: "Robinhood Chain", highlight: true },
  { name: "GMGN" },
  { name: "Uniswap v4" },
  { name: "Lighter" },
  { name: "Privy" },
];

/** Real infrastructure this product actually integrates with - the
 * trencher-voice answer to a "trusted partners" logo strip, without
 * fabricating logos or affiliations that don't exist. */
export function VenuesStrip() {
  return (
    <section className="border-y border-border/60 bg-secondary/30">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <Reveal className="text-center">
          <p className="text-xs font-semibold tracking-[0.25em] uppercase text-muted-foreground">
            Real Fills on Real Infrastructure
          </p>
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {VENUES.map((venue) => (
              <span
                key={venue.name}
                className={
                  venue.highlight
                    ? "rounded-full border border-accent/40 bg-accent/10 px-5 py-2 text-sm font-medium text-foreground"
                    : "rounded-full border border-border/60 px-5 py-2 text-sm text-muted-foreground"
                }
              >
                {venue.name}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
