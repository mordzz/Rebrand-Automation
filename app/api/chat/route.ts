import { NextResponse } from "next/server";

import {
  DASHBOARD_ENTITY_ID,
  DASHBOARD_ROOM_ID,
  getElizaRuntime,
} from "@/lib/eliza/runtime";
import { recordModelUsage } from "@/lib/model-usage";

// Agent state must not be cached - every reply depends on live wallet/lesson data.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const runtimePromise = getElizaRuntime();
  if (!runtimePromise) {
    return NextResponse.json({
      configured: false,
      reply:
        "The concierge isn't wired up yet - set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY.",
    });
  }

  const startedAt = Date.now();
  try {
    const runtime = await runtimePromise;

    // Free-tier model providers can be slow or hang on upstream rate-limits
    // in ways that don't cleanly reject handleMessage's own promise (seen in
    // practice: an OpenRouter 429 surfaced as a process-level unhandled
    // rejection, not a caught error here). Race against a timeout so this
    // route always responds instead of hanging until the client gives up.
    const result = await Promise.race([
      runtime.messageService!.handleMessage(runtime, {
        entityId: DASHBOARD_ENTITY_ID,
        roomId: DASHBOARD_ROOM_ID,
        content: { text: body.text, source: "web" },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 75_000)
      ),
    ]);

    // Real, measured round-trip latency for this chat turn - the
    // MODEL_USED event ElizaOS emits internally (see lib/eliza/runtime.ts)
    // doesn't carry timing, so this is recorded separately, tagged
    // modelType: "chat_turn" to distinguish it from per-model-call rows.
    void recordModelUsage({
      modelType: "chat_turn",
      latencyMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      configured: true,
      reply: result.responseContent?.text ?? "…",
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "timeout";
    return NextResponse.json({
      configured: true,
      reply: timedOut
        ? "The model is taking too long to respond (likely a busy free-tier provider) - try again in a moment."
        : "Something interrupted the automaton mid-thought. Try again in a moment.",
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
