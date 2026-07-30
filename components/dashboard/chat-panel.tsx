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
  title = "The Concierge",
  subtitle = "Ask about your balance, positions, or strategies.",
  placeholder = "Ask the concierge…",
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  thinking: boolean;
  title?: string;
  subtitle?: string;
  placeholder?: string;
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 py-3">
        <p className="text-[0.7rem] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
          {title}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
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
        className="m-3 mt-1 flex items-center gap-2 rounded-full bg-secondary py-1 pr-1.5 pl-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        />
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          aria-label="Send message"
          className="text-accent hover:text-accent"
        >
          <SendHorizonal className="size-4" />
        </Button>
      </form>
    </div>
  );
}
