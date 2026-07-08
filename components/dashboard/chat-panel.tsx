"use client";

import { SendHorizonal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
};

export function ChatPanel({
  messages,
  onSend,
  thinking,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  thinking: boolean;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, thinking]);

  function submit() {
    const text = draft.trim();
    if (!text || thinking) return;
    setDraft("");
    onSend(text);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-medium">The Concierge</p>
        <p className="text-xs text-muted-foreground">
          Ask about your balance, positions, or strategies.
        </p>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
              m.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : "bg-muted text-foreground"
            )}
          >
            {m.text}
          </div>
        ))}
        {thinking && (
          <div className="w-fit rounded-xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
            <span className="inline-flex gap-1">
              <span className="animate-blink">·</span>
              <span className="animate-blink [animation-delay:200ms]">·</span>
              <span className="animate-blink [animation-delay:400ms]">·</span>
            </span>
          </div>
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask the concierge…"
          className="h-9 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Button type="submit" size="icon" aria-label="Send message">
          <SendHorizonal className="size-4" />
        </Button>
      </form>
    </div>
  );
}
