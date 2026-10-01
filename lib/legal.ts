import fs from "node:fs";
import path from "node:path";

/** The two legal documents, read from content/ the same way the whitepaper
 * is. Kept as markdown rather than JSX for the reason that matters for a
 * legal document: the text a lawyer reviews and the text a visitor reads
 * are then literally the same file, with no markup between them. */
export type LegalDoc = "privacy" | "terms";

const TITLES: Record<LegalDoc, { eyebrow: string; lead: string; tail: string }> = {
  privacy: {
    eyebrow: "Privacy Policy",
    lead: "What we hold,",
    tail: "and what we cannot.",
  },
  terms: {
    eyebrow: "Terms of Service",
    lead: "The agreement,",
    tail: "stated plainly.",
  },
};

export function legalTitle(doc: LegalDoc) {
  return TITLES[doc];
}

const cache = new Map<LegalDoc, string>();

/** ⟦FILL: …⟧ markers become the same badge the whitepaper renders, and
 * §N references become links into the whitepaper - these documents cite it
 * constantly and a reader should be able to follow the citation rather
 * than being told a section number and left to find it. The whitepaper's
 * own transform links §N within its own page; here the target is a
 * different route, so the href is absolute. */
function transform(text: string): string {
  return text
    .replace(/⟦FILL:([^⟧]*)⟧/g, (_m, inner: string) => `[FILL:${inner}](#fill)`)
    .replace(/⟦FILL⟧/g, "[FILL](#fill)")
    .replace(
      /§(\d+(?:\.\d+)?)/g,
      (_m, num: string) => `[$${num}](/whitepaper#section-${num.replace(/\./g, "-")})`
    );
}

function processLine(line: string): string {
  // Inline code is left alone: markdown does not parse links inside a code
  // span anyway, so transforming there only corrupts the literal text.
  return line
    .split(/(`[^`]*`)/g)
    .map((segment, i) => (i % 2 === 1 ? segment : transform(segment)))
    .join("");
}

export function getLegalMarkdown(doc: LegalDoc): string {
  const cached = cache.get(doc);
  if (cached != null) return cached;

  const raw = fs.readFileSync(
    path.join(process.cwd(), "content", `${doc}.md`),
    "utf-8"
  );

  let inFence = false;
  const out = raw
    .split("\n")
    .map((line) => {
      if (/^```/.test(line.trim())) {
        inFence = !inFence;
        return line;
      }
      if (inFence || /^#{1,6}\s/.test(line)) return line;
      return processLine(line);
    })
    .join("\n");

  cache.set(doc, out);
  return out;
}

/** Last-updated line, read from the document itself so the page and the
 * text can never disagree about the date. */
export function getLegalUpdated(doc: LegalDoc): string | null {
  const match = getLegalMarkdown(doc).match(/Last updated ([0-9]{1,2} \w+ [0-9]{4})/);
  return match ? match[1] : null;
}
