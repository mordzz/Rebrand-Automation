import Anthropic from "@anthropic-ai/sdk";

export type LlmMessage = { role: "user" | "assistant"; content: string };

type Resolved =
  | { kind: "anthropic"; model: string }
  | { kind: "openai-compatible"; label: string; baseUrl: string; apiKey: string; model: string };

const ANTHROPIC_DEFAULT_MODEL = "claude-opus-4-8";

/**
 * Picks the chat model from whatever the environment actually provides.
 *
 * OpenRouter is the base provider by operator decision: it fronts many
 * vendors behind the one key this project already has, so nothing else
 * needs configuring. Anthropic and OpenAI stay as fallbacks purely so a
 * deployment that has one of those keys and no OpenRouter key still
 * works — neither is required, and neither wins when OpenRouter is set.
 *
 * Returns null when nothing is configured, so callers degrade with a
 * useful message instead of throwing an auth error at a visitor.
 */
export function resolveLlm(): Resolved | null {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      kind: "openai-compatible",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      // OPENROUTER_LARGE_MODEL is the app's existing convention (see .env).
      model: process.env.OPENROUTER_LARGE_MODEL || "openrouter/auto",
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      kind: "anthropic",
      model: process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL,
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      kind: "openai-compatible",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    };
  }
  return null;
}

export function isLlmConfigured(): boolean {
  return resolveLlm() !== null;
}

/** The model id actually used, for recording alongside what it produced.
 * Callers should persist this rather than trusting a column default —
 * a lesson attributed to the wrong model is a lesson you cannot audit. */
export function llmModelId(): string {
  return resolveLlm()?.model ?? "unconfigured";
}

/** Names the configured provider for operator-facing error text. */
export function llmLabel(): string {
  const resolved = resolveLlm();
  if (!resolved) return "none";
  return resolved.kind === "anthropic"
    ? `Anthropic ${resolved.model}`
    : `${resolved.label} ${resolved.model}`;
}

/**
 * One completion. `system` is passed as a real system prompt on Anthropic
 * and as a leading system message on OpenAI-compatible APIs — the same
 * instruction either way.
 *
 * Throws when no provider is configured; call isLlmConfigured() first if
 * you need to degrade gracefully.
 */
export async function llmChat(params: {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
}): Promise<string> {
  const resolved = resolveLlm();
  if (!resolved) throw new Error("No LLM provider configured");

  const maxTokens = params.maxTokens ?? 500;

  if (resolved.kind === "anthropic") {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: resolved.model,
      max_tokens: maxTokens,
      system: params.system,
      messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    if (response.stop_reason === "refusal") {
      return "I'd rather not answer that one.";
    }
    const block = response.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "…";
  }

  const response = await fetch(`${resolved.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolved.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolved.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: params.system },
        ...params.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${resolved.label} ${response.status}: ${detail.slice(0, 300)}`
    );
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
    error?: { message?: string };
  };
  if (json.error) throw new Error(json.error.message ?? `${resolved.label} error`);

  const text = json.choices?.[0]?.message?.content;
  return typeof text === "string" && text.trim().length > 0 ? text.trim() : "…";
}

/**
 * Pulls the first JSON object out of a model reply.
 *
 * Necessary because structured-output support is not universal: OpenRouter
 * routes to whatever model backs the configured slug, and free models in
 * particular ignore `response_format` and wrap their answer in prose or
 * markdown fences — one was observed prefixing replies with a safety
 * classifier header. Scanning for the first balanced object is the only
 * thing that survives all of those; string-awareness stops a brace inside
 * a quoted value from ending the scan early.
 */
export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * One completion constrained to a JSON object matching `schema`.
 *
 * Asks the provider for structured output where it is supported, but never
 * relies on it: the schema is also stated in the prompt, and the reply is
 * salvaged with extractJsonObject before parsing. Throws if no JSON object
 * can be recovered — callers must treat that as a failed analysis rather
 * than inventing a result.
 */
export async function llmJson<T>(params: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
}): Promise<T> {
  const resolved = resolveLlm();
  if (!resolved) throw new Error("No LLM provider configured");

  const maxTokens = params.maxTokens ?? 4000;
  const system = `${params.system}

Reply with a single JSON object and nothing else — no prose before or after it, no markdown fences. It must match this JSON Schema:
${JSON.stringify(params.schema)}`;

  let raw: string;

  if (resolved.kind === "anthropic") {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: resolved.model,
      max_tokens: maxTokens,
      system,
      output_config: { format: { type: "json_schema", schema: params.schema } },
      messages: [{ role: "user", content: params.user }],
    });
    if (response.stop_reason === "refusal") {
      throw new Error("Analysis was refused by the model");
    }
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("No text in model response");
    raw = block.text;
  } else {
    const response = await fetch(`${resolved.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolved.model,
        max_tokens: maxTokens,
        response_format: {
          type: "json_schema",
          json_schema: { name: params.schemaName, strict: true, schema: params.schema },
        },
        messages: [
          { role: "system", content: system },
          { role: "user", content: params.user },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${resolved.label} ${response.status}: ${detail.slice(0, 300)}`);
    }
    const json = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
      error?: { message?: string };
    };
    if (json.error) throw new Error(json.error.message ?? `${resolved.label} error`);
    raw = json.choices?.[0]?.message?.content ?? "";
  }

  const candidate = extractJsonObject(raw);
  if (!candidate) {
    throw new Error(`No JSON object in model reply: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(candidate) as T;
}
