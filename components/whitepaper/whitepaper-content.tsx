import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { markdownComponents } from "@/components/markdown/markdown-components";
import { getWhitepaperMarkdown } from "@/lib/whitepaper";

export function WhitepaperContent() {
  const markdown = getWhitepaperMarkdown();
  return (
    <div className="min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
