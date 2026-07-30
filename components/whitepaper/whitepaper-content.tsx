import { ExternalLink } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { getWhitepaperMarkdown, slugForHeading } from "@/lib/whitepaper";
import { cn } from "@/lib/utils";

function flattenText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (
    node &&
    typeof node === "object" &&
    "props" in node &&
    node.props &&
    typeof node.props === "object" &&
    "children" in node.props
  ) {
    return flattenText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

/** react-markdown component overrides styled for long-form reading against
 * the site's dark theme — this document is read start-to-finish and cross-
 * references itself constantly, so headings get stable ids (matching
 * lib/whitepaper.ts#slugForHeading) and §-references become real jumps. */
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-0 text-3xl font-medium tracking-tight text-primary sm:text-4xl">
      {children}
    </h1>
  ),
  h2: ({ children }) => {
    const text = flattenText(children);
    return (
      <h2
        id={slugForHeading(text)}
        className="mt-14 scroll-mt-28 border-t border-white/10 pt-10 text-2xl font-medium tracking-tight text-primary first:mt-0 first:border-t-0 first:pt-0"
      >
        {children}
      </h2>
    );
  },
  h3: ({ children }) => {
    const text = flattenText(children);
    return (
      <h3
        id={slugForHeading(text)}
        className="mt-8 scroll-mt-28 text-lg font-medium text-primary"
      >
        {children}
      </h3>
    );
  },
  p: ({ children }) => (
    <p className="mt-4 text-sm leading-relaxed text-foreground/80 sm:text-base">{children}</p>
  ),
  strong: ({ children }) => <strong className="font-semibold text-primary">{children}</strong>,
  em: ({ children }) => (
    <em className="font-instrument not-italic italic text-primary/80">{children}</em>
  ),
  ul: ({ children }) => (
    <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground/80 sm:text-base">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-foreground/80 sm:text-base">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  hr: () => <hr className="my-10 border-white/10" />,
  blockquote: ({ children }) => (
    <blockquote className="mt-6 rounded-xl border border-accent/30 bg-accent/[0.06] px-5 py-4 text-sm leading-relaxed text-foreground/90 sm:text-base">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    // Fenced code blocks arrive with a `language-*` className on the inner
    // <code>; inline code doesn't. Only fenced blocks need block styling —
    // inline code (e.g. `pending`) stays inline.
    if (!className) {
      return (
        <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-primary">
          {children}
        </code>
      );
    }
    return <code className={className}>{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="mt-5 overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-[0.7rem] leading-relaxed text-foreground/80 sm:text-xs">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[480px] text-left text-xs sm:text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-white/10 px-4 py-2.5 text-[0.65rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase sm:text-[0.7rem]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-white/5 px-4 py-2.5 align-top text-foreground/80 last:border-b-0">
      {children}
    </td>
  ),
  tr: ({ children }) => <tr className="last:[&>td]:border-b-0">{children}</tr>,
  a: ({ href, children }) => {
    if (href === "#fill") {
      return (
        <span className="inline-flex items-center rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[0.8em] whitespace-nowrap text-accent">
          ⟦{flattenText(children)}⟧
        </span>
      );
    }
    const isInternal = href?.startsWith("#");
    return (
      <a
        href={href}
        target={isInternal ? undefined : "_blank"}
        rel={isInternal ? undefined : "noreferrer"}
        className={cn(
          "text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary",
          !isInternal && "inline-flex items-center gap-1"
        )}
      >
        {children}
        {!isInternal && <ExternalLink className="inline size-3" />}
      </a>
    );
  },
};

export function WhitepaperContent() {
  const markdown = getWhitepaperMarkdown();
  return (
    <div className="min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
