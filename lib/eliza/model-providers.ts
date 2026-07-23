export type ProviderId = "openrouter" | "anthropic" | "openai";

export type ProviderStatus = {
  id: ProviderId;
  name: string;
  configured: boolean; // API key present
  enabled: boolean; // configured AND not explicitly disabled via env
};

/**
 * Enabled by default whenever the key is configured; an explicit
 * ELIZA_<PROVIDER>_ENABLED="false" force-disables it without removing the
 * key (e.g. to temporarily take a provider out of rotation).
 */
function resolveEnabled(envVar: string, configured: boolean): boolean {
  const raw = process.env[envVar];
  if (raw == null || raw === "") return configured;
  return configured && raw === "true";
}

/**
 * Real provider status — no user-facing toggle, no runtime restart needed
 * to "connect": whichever of these are enabled is exactly what
 * lib/eliza/runtime.ts wires up on process start. Order reflects the same
 * priority order used there (see lib/eliza/character.ts).
 */
export function getProviderStatuses(): ProviderStatus[] {
  const openrouterConfigured = Boolean(process.env.OPENROUTER_API_KEY);
  const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);

  return [
    {
      id: "openrouter",
      name: "OpenRouter",
      configured: openrouterConfigured,
      enabled: resolveEnabled("ELIZA_OPENROUTER_ENABLED", openrouterConfigured),
    },
    {
      id: "anthropic",
      name: "Anthropic Claude",
      configured: anthropicConfigured,
      enabled: resolveEnabled("ELIZA_ANTHROPIC_ENABLED", anthropicConfigured),
    },
    {
      id: "openai",
      name: "OpenAI",
      configured: openaiConfigured,
      enabled: resolveEnabled("ELIZA_OPENAI_ENABLED", openaiConfigured),
    },
  ];
}

/**
 * Best-effort attribution for usage tracking: ElizaOS's MODEL_USED event
 * doesn't say which provider actually served a call, so we attribute it to
 * the highest-priority *enabled* provider. Accurate whenever only one
 * provider is enabled (the common case); an approximation if several are.
 */
export function primaryEnabledProvider(): ProviderId | null {
  return getProviderStatuses().find((p) => p.enabled)?.id ?? null;
}
