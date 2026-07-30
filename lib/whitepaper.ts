import fs from "node:fs";
import path from "node:path";

const WHITEPAPER_PATH = path.join(process.cwd(), "content", "whitepaper.md");

export type TocEntry = {
  id: string;
  text: string;
  level: 2 | 3;
};

/** "7.1 Custody model" -> "section-7-1"; "1. Abstract" -> "section-1";
 * "Appendix A — Default Configuration" -> "appendix-a". Falls back to a
 * generic slug for the two non-numbered title lines at the very top. */
export function slugForHeading(text: string): string {
  const appendix = text.match(/^Appendix\s+([A-E])\b/i);
  if (appendix) return `appendix-${appendix[1].toLowerCase()}`;

  const numbered = text.match(/^(\d+(?:\.\d+)?)\.?\s/);
  if (numbered) return `section-${numbered[1].replace(/\./g, "-")}`;

  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "section"
  );
}

function transformPlainText(text: string): string {
  let out = text.replace(/⟦FILL:([^⟧]*)⟧/g, (_m, inner: string) => `[FILL:${inner}](#fill)`);
  out = out.replace(/⟦FILL⟧/g, "[FILL](#fill)");
  out = out.replace(
    /§(\d+(?:\.\d+)?)/g,
    (_m, num: string) => `[§${num}](#section-${num.replace(/\./g, "-")})`
  );
  return out;
}

/** Wraps ⟦FILL: …⟧ / ⟦FILL⟧ markers in a fake link the `a` component
 * override renders as a styled badge instead of an anchor, and turns every
 * §N / §N.M cross-reference into a real link to that section's heading —
 * this document references its own sections dozens of times and is meant
 * to be read as a navigable spec, not a flat scroll. Heading lines are
 * left untouched so a heading never links to itself.
 *
 * Splits on backtick-delimited inline code first and leaves those segments
 * untouched — the "Notation" paragraph shows the literal ⟦FILL: …⟧ syntax
 * inside backticks as an example, and markdown doesn't parse link syntax
 * inside a code span anyway, so transforming it there just corrupts it. */
function processBodyLine(line: string): string {
  return line
    .split(/(`[^`]*`)/g)
    .map((segment, i) => (i % 2 === 1 ? segment : transformPlainText(segment)))
    .join("");
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s/.test(line);
}

let cachedRaw: string | null = null;
function readRaw(): string {
  if (cachedRaw == null) {
    cachedRaw = fs.readFileSync(WHITEPAPER_PATH, "utf-8");
  }
  return cachedRaw;
}

/** The full document, with FILL markers and §-references rewritten for
 * rendering — see processBodyLine. Heading lines and the contents of
 * fenced code blocks (the ASCII pipeline diagram, the refusal-feed log,
 * the break-even formula) are left completely untouched — those must
 * render as literal text, not have link syntax injected into them. */
export function getWhitepaperMarkdown(): string {
  let inFence = false;
  return readRaw()
    .split("\n")
    .map((line) => {
      if (/^```/.test(line.trim())) {
        inFence = !inFence;
        return line;
      }
      if (inFence || isHeadingLine(line)) return line;
      return processBodyLine(line);
    })
    .join("\n");
}

/** Table of contents: every H2/H3 that starts with a section number or is
 * an Appendix heading — skips the two top-of-document title lines. */
export function getWhitepaperToc(): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const line of readRaw().split("\n")) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (!match) continue;
    const level = match[1].length as 2 | 3;
    const text = match[2].trim();
    if (!/^\d+(\.\d+)?\.?\s/.test(text) && !/^Appendix\s+[A-E]\b/i.test(text)) continue;
    entries.push({ id: slugForHeading(text), text, level });
  }
  return entries;
}
