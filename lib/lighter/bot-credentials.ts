/**
 * Per-bot Lighter credential service (DB-backed) - PR12.
 *
 * Main-thread code here only ever handles the ENCRYPTED API key blob and
 * public metadata. Routine L2 signing (orders, cancels, leverage, auth
 * tokens) uses the Lighter API key only; the EVM agent key is used solely
 * for the L1 ChangePubKey authorization in registration.
 */
import { eq } from "drizzle-orm";

import { signLighterApiKeyRegistration } from "@/lib/chain/lighter-registration-signing";
import { getDb } from "@/lib/db";
import { userBots } from "@/drizzle/schema";
import { getLighterConfig } from "@/lib/lighter/config";
import { registerAgentApiKey, type LighterBotCredential, type LighterCredentialStore } from "@/lib/lighter/registration";
import { LighterSigner } from "@/lib/lighter/signer-adapter";

type BotRow = typeof userBots.$inferSelect;

export function isLighterCredentialConfigured(): boolean {
  const raw = process.env.LIGHTER_API_KEY_ENCRYPTION_KEY?.trim();
  if (!raw) return false;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return buf.length === 32;
}

export function dbCredentialStore(botId: string): LighterCredentialStore {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  return {
    async savePending(p) {
      await db
        .update(userBots)
        .set({
          lighterNetwork: p.network,
          lighterAccountIndex: p.accountIndex,
          lighterApiKeyIndex: p.apiKeyIndex,
          lighterApiPublicKey: p.publicKey,
          lighterApiKeyEnc: p.apiKeyEnc,
          lighterApiKeyStatus: "pending",
          updatedAt: new Date(),
        })
        .where(eq(userBots.id, botId));
    },
    async markRegistered() {
      await db
        .update(userBots)
        .set({ lighterApiKeyStatus: "registered", lighterApiKeyRegisteredAt: new Date(), updatedAt: new Date() })
        .where(eq(userBots.id, botId));
    },
  };
}

function toCredential(bot: BotRow): LighterBotCredential {
  return {
    agentChain: bot.agentChain,
    agentNetwork: bot.agentNetwork,
    agentPublicKey: bot.agentPublicKey,
    agentSecretEnc: bot.agentSecretEnc,
    lighterNetwork: bot.lighterNetwork,
    lighterAccountIndex: bot.lighterAccountIndex,
    lighterApiKeyIndex: bot.lighterApiKeyIndex,
    lighterApiPublicKey: bot.lighterApiPublicKey,
    lighterApiKeyEnc: bot.lighterApiKeyEnc,
    lighterApiKeyStatus: bot.lighterApiKeyStatus,
  };
}

/** Idempotently registers the bot's agent-owned Lighter API key (testnet). */
export async function registerBotLighterApiKey(bot: BotRow) {
  if (!isLighterCredentialConfigured()) throw new Error("LIGHTER_API_KEY_ENCRYPTION_KEY is not configured");
  return registerAgentApiKey(toCredential(bot), {
    config: getLighterConfig(),
    store: dbCredentialStore(bot.id),
    signRegistration: (b, intent, prepared) => signLighterApiKeyRegistration(b, intent, prepared),
  });
}

/** Opens a signer for routine L2 operations with the registered API key. */
export async function openBotLighterSigner(bot: BotRow): Promise<LighterSigner> {
  const config = getLighterConfig();
  if (
    bot.lighterApiKeyStatus !== "registered" ||
    bot.lighterNetwork !== config.network ||
    bot.lighterAccountIndex == null ||
    bot.lighterApiKeyIndex == null ||
    !bot.lighterApiKeyEnc
  ) {
    throw new Error("Bot has no registered Lighter API key on the active network");
  }
  return LighterSigner.open({
    config,
    accountIndex: bot.lighterAccountIndex,
    apiKeyIndex: bot.lighterApiKeyIndex,
    apiKeyEnc: bot.lighterApiKeyEnc,
  });
}
