/**
 * Maps this app's existing env vars onto the setting names ElizaOS's model
 * plugins expect. No secret is duplicated under a second env var name.
 *
 * Solana isn't handled here: @elizaos/plugin-solana was dropped (it throws
 * on import in the published 2.0.0-alpha.6 build - a name mismatch between
 * its generated action-spec registry and its own lookup key, unrelated to
 * anything in this app). Wallet reads and the gated transfer action talk to
 * nothing: the Solana house wallet (PRIVATE_KEY_SOLANA_WALLET) and its
 * chat balance provider were retired in PR16.
 */
export function buildElizaSettings(): Record<string, string> {
  const settings: Record<string, string> = {};

  if (process.env.ANTHROPIC_API_KEY) {
    settings.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.OPENAI_API_KEY) {
    settings.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  }
  if (process.env.OPENROUTER_API_KEY) {
    settings.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    // Defaults to "openrouter/free", OpenRouter's own auto-router across
    // its whole free catalog. Tried pinning to specific free models first
    // (meta-llama/llama-3.3-70b-instruct:free, nvidia/nemotron-3-ultra-550b-
    // a55b:free, openai/gpt-oss-120b:free) and hit a different real failure
    // on each - 429 rate-limited, upstream DEGRADED, 429 again - within a
    // few minutes of each other. That's the free tier being genuinely
    // congested, not a bad model choice; the auto-router routes around
    // exactly this by picking a different available model per request,
    // at the cost of less predictable tool-calling reliability than any
    // one pinned model would have. Overridable via .env
    // (OPENROUTER_LARGE_MODEL/OPENROUTER_SMALL_MODEL) without touching this
    // file - `||`, not `??`, so an empty-string placeholder left in .env
    // (as .env.example ships it) falls back to the default below instead
    // of handing OpenRouter an empty model name.
    settings.OPENROUTER_LARGE_MODEL =
      process.env.OPENROUTER_LARGE_MODEL || "openrouter/free";
    settings.OPENROUTER_SMALL_MODEL =
      process.env.OPENROUTER_SMALL_MODEL || "openrouter/free";
  }
  // ElizaOS's SQL plugin reads its connection from the POSTGRES_URL
  // *setting*; it is the same database as the app's DATABASE_URL.
  if (process.env.DATABASE_URL) {
    settings.POSTGRES_URL = process.env.DATABASE_URL;
  }

  return settings;
}
