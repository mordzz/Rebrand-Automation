import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { markdownComponents } from "@/components/markdown/markdown-components";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getLegalMarkdown, getLegalUpdated, legalTitle, type LegalDoc } from "@/lib/legal";

/** One layout for both legal documents, matching /whitepaper so the three
 * long-form pages read as one set. No table of contents: these are short
 * enough to scroll, and a sidebar on a two-screen document is furniture. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const { eyebrow, lead, tail } = legalTitle(doc);
  const updated = getLegalUpdated(doc);
  const other: LegalDoc = doc === "privacy" ? "terms" : "privacy";

  return (
    <>
      <div className="bg-noise pointer-events-none fixed inset-0 opacity-[0.15]" />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-24 right-[15%] h-96 w-96 rounded-full bg-primary/10 blur-[130px]"
      />
      {/* The header is a floating pill on a transparent page; on a
          text-dense document the body would otherwise scroll visibly
          through it. Same scrim as the whitepaper. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-40 h-24 bg-gradient-to-b from-background via-background/85 to-transparent"
      />
      <SiteHeader />
      <main className="relative flex-1">
        <div className="relative mx-auto max-w-[52rem] px-5 py-8 sm:px-8">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-6 border-b border-white/10 pb-8">
            <div className="min-w-0">
              <p className="text-primary text-[10px] tracking-widest uppercase sm:text-xs">
                {eyebrow}
              </p>
              <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
                {lead}{" "}
                <em className="font-instrument font-normal italic text-foreground/60">
                  {tail}
                </em>
              </h1>
              <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
                Fields marked ⟦FILL⟧ are values this document cannot assert
                until they are decided or reviewed. Legal review is
                outstanding.
              </p>
            </div>
            {updated && (
              <dl className="shrink-0 text-xs">
                <dt className="text-[0.65rem] tracking-[0.15em] text-muted-foreground uppercase">
                  Last updated
                </dt>
                <dd className="mt-1.5 text-lg font-medium">{updated}</dd>
              </dl>
            )}
          </div>

          <div className="min-w-0 rounded-2xl bg-card px-5 py-8 sm:px-9 sm:py-12">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {getLegalMarkdown(doc)}
            </ReactMarkdown>
          </div>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link
              href={`/${other}`}
              className="text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary"
            >
              {other === "terms" ? "Terms of Service" : "Privacy Policy"}
            </Link>
            <Link
              href="/whitepaper"
              className="text-muted-foreground underline decoration-muted-foreground/30 underline-offset-4 transition-colors hover:text-foreground"
            >
              Whitepaper
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter slim />
    </>
  );
}
