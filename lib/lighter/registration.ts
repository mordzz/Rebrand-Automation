/**
 * Lighter API-key registration (ChangePubKey) — PR12.
 *
 * Ownership model: the Lighter account is owned by the bot's AUTONOMOUS
 * AGENT wallet (`bot.agentPublicKey`), never the owner's Privy wallet.
 *
 * Flow (all semantics from lighter-go v1.0.10 / lighter-python, pinned):
 *   1. resolve the agent's Lighter account authoritatively via
 *      accountsByL1Address(agent) — never a caller-supplied index
 *   2. idempotency: reuse an already-registered / pending key; never rotate
 *      implicitly; refuse to overwrite a slot holding someone else's key
 *   3. new key: official GenerateAPIKey INSIDE the signer worker; persist
 *      the encrypted blob as "pending" BEFORE submitting anything
 *   4. official SignChangePubKey (in the worker) → txInfo + messageToSign
 *   5. verifyPreparedChangePubKey: independently rebuild the official
 *      TemplateChangePubKey message and check every bound field
 *   6. agent wallet signs exactly that message (EIP-191) inside the
 *      existing agent-key boundary (lib/chain/lighter-registration-signing)
 *   7. attach `L1Sig` (official field), POST sendTx
 *   8. confirm via GET /api/v1/apikeys — submission alone is not success
 *
 * TESTNET ONLY: registration is a state change on Lighter.
 */
import { getAddress, isAddress, type Address } from "viem";

import type { AgentWalletBotRow } from "@/lib/chain/robinhood-agent-wallet";
import { LighterClient, type LighterApiKeyRecord } from "@/lib/lighter/client";
import type { LighterConfig } from "@/lib/lighter/config";
import { httpNextNonce, httpSendTx, type NextNonce, type SendTx } from "@/lib/lighter/orders";
import { LIGHTER_TX_TYPE, LighterSigner, type PreparedChangePubKey } from "@/lib/lighter/signer-adapter";

/** First non-reserved API key slot (0–1 are reserved for web/mobile per docs). */
export const DEFAULT_LIGHTER_API_KEY_INDEX = 2;

export class LighterRegistrationError extends Error {
  constructor(
    readonly kind:
      | "mainnet_refused"
      | "no_account"
      | "ambiguous_account"
      | "slot_occupied"
      | "intent_mismatch"
      | "not_confirmed"
      | "invalid_state",
    message: string,
  ) {
    super(message);
    this.name = "LighterRegistrationError";
  }
}

/** Everything the L1 signature is allowed to authorize. */
export type ApiKeyRegistrationIntent = {
  network: LighterConfig["network"];
  lighterChainId: number;
  l1Owner: Address;
  accountIndex: number;
  apiKeyIndex: number;
  /** 40-byte public key, hex (with or without 0x). */
  publicKeyHex: string;
  nonce: number;
};

/** lighter-go getHex10FromUint64: "0x" + at-least-16-digit lowercase hex. */
function hex10(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new LighterRegistrationError("intent_mismatch", "invalid uint64 field");
  return `0x${value.toString(16).padStart(16, "0")}`;
}

function normalizePubKey(hex: string): string {
  const h = hex.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{80}$/.test(h)) throw new LighterRegistrationError("intent_mismatch", "API public key must be 40 bytes of hex");
  return h;
}

/** Official TemplateChangePubKey (lighter-go types/txtypes/utils.go @ v1.0.10). */
export function buildChangePubKeyMessage(i: Pick<ApiKeyRegistrationIntent, "publicKeyHex" | "nonce" | "accountIndex" | "apiKeyIndex">): string {
  return (
    `Register Lighter Account\n\npubkey: 0x${normalizePubKey(i.publicKeyHex)}\nnonce: ${hex10(i.nonce)}\n` +
    `account index: ${hex10(i.accountIndex)}\napi key index: ${hex10(i.apiKeyIndex)}\n` +
    "Only sign this message for a trusted client!"
  );
}

/**
 * Independent verification of the official signer's ChangePubKey output
 * against the intent. Throws on ANY deviation — run before the agent key
 * is loaded.
 */
export function verifyPreparedChangePubKey(prepared: PreparedChangePubKey, intent: ApiKeyRegistrationIntent): void {
  const fail = (m: string): never => {
    throw new LighterRegistrationError("intent_mismatch", `ChangePubKey refused: ${m}`);
  };
  if (intent.network !== "testnet") fail("registration is testnet-only");
  if (intent.lighterChainId !== 300) fail(`signing domain ${intent.lighterChainId} is not the Lighter testnet domain (300)`);
  if (!isAddress(intent.l1Owner)) fail("l1Owner is not an EVM address");
  if (!Number.isInteger(intent.apiKeyIndex) || intent.apiKeyIndex < 2 || intent.apiKeyIndex > 254) fail("apiKeyIndex outside 2..254");
  if (prepared.txType !== LIGHTER_TX_TYPE.changePubKey) fail(`tx type ${prepared.txType} is not ChangePubKey (8)`);
  if (prepared.nonce !== intent.nonce) fail("nonce differs from intent");

  let info: Record<string, unknown>;
  try {
    info = JSON.parse(prepared.txInfo) as Record<string, unknown>;
  } catch {
    return fail("txInfo is not JSON");
  }
  if (info.AccountIndex !== intent.accountIndex) fail("AccountIndex differs from intent");
  if (info.ApiKeyIndex !== intent.apiKeyIndex) fail("ApiKeyIndex differs from intent");
  if (info.Nonce !== intent.nonce) fail("Nonce differs from intent");
  // PubKey is a Go []byte → base64 in JSON.
  const pub = Buffer.from(normalizePubKey(intent.publicKeyHex), "hex").toString("base64");
  if (info.PubKey !== pub) fail("PubKey differs from intent");
  if (info.L1Sig !== undefined && info.L1Sig !== "") fail("txInfo already carries an L1Sig");
  if (prepared.messageToSign !== buildChangePubKeyMessage(intent)) fail("messageToSign is not the official ChangePubKey message for this intent");
}

/** Attaches the L1 signature exactly as the official SDK does. */
export function attachL1Sig(prepared: PreparedChangePubKey, l1Sig: `0x${string}`): { txType: number; txInfo: string; txHash: string; nonce: number } {
  if (!/^0x[0-9a-f]{130}$/i.test(l1Sig)) throw new LighterRegistrationError("intent_mismatch", "L1Sig must be a 65-byte hex signature");
  const info = JSON.parse(prepared.txInfo) as Record<string, unknown>;
  info.L1Sig = l1Sig;
  return { txType: prepared.txType, txInfo: JSON.stringify(info), txHash: prepared.txHash, nonce: prepared.nonce };
}

/** Resolves THE agent-owned Lighter account. Never trusts caller input. */
export async function resolveAgentLighterAccount(
  client: Pick<LighterClient, "getSubAccounts">,
  agentAddress: string,
  storedAccountIndex: number | null,
): Promise<number> {
  const agent = getAddress(agentAddress);
  const owned = (await client.getSubAccounts(agent)).filter((a) => isAddress(a.l1Address) && getAddress(a.l1Address) === agent);
  if (owned.length === 0) {
    throw new LighterRegistrationError("no_account", `No Lighter account exists for agent wallet ${agent} (it is created by a collateral deposit)`);
  }
  if (storedAccountIndex !== null) {
    if (!owned.some((a) => a.accountIndex === storedAccountIndex)) {
      throw new LighterRegistrationError("ambiguous_account", `Stored Lighter account ${storedAccountIndex} is not owned by ${agent}`);
    }
    return storedAccountIndex;
  }
  if (owned.length > 1) {
    // Lighter does not document a master-account selection rule we can
    // rely on here; refuse rather than pick an unrelated sub-account.
    throw new LighterRegistrationError("ambiguous_account", `Agent wallet ${agent} owns ${owned.length} Lighter accounts; an explicit stored mapping is required`);
  }
  return owned[0].accountIndex;
}

/** Persistence for the per-bot Lighter credential (DB in production). */
export type LighterCredentialStore = {
  savePending(p: { network: string; accountIndex: number; apiKeyIndex: number; publicKey: string; apiKeyEnc: string }): Promise<void>;
  markRegistered(p: { publicKey: string }): Promise<void>;
};

export type LighterBotCredential = AgentWalletBotRow & {
  lighterNetwork: string | null;
  lighterAccountIndex: number | null;
  lighterApiKeyIndex: number | null;
  lighterApiPublicKey: string | null;
  lighterApiKeyEnc: string | null;
  lighterApiKeyStatus: string | null;
};

export type RegistrationDeps = {
  config: LighterConfig;
  store: LighterCredentialStore;
  client?: Pick<LighterClient, "getSubAccounts" | "getApiKeys" | "assertNetwork">;
  nextNonce?: NextNonce;
  sendTx?: SendTx;
  openSigner?: typeof LighterSigner.open;
  provisionSigner?: typeof LighterSigner.provision;
  /** Agent-wallet L1 signer — lib/chain/lighter-registration-signing.ts. */
  signRegistration: (bot: AgentWalletBotRow, intent: ApiKeyRegistrationIntent, prepared: PreparedChangePubKey) => Promise<`0x${string}`>;
  confirmAttempts?: number;
  confirmDelayMs?: number;
};

const samePub = (a: string, b: string) => a.toLowerCase().replace(/^0x/, "") === b.toLowerCase().replace(/^0x/, "");

export type RegistrationResult = { accountIndex: number; apiKeyIndex: number; publicKey: string; status: "registered"; reused: boolean; txHash?: string };

/** Idempotent registration of the bot's Lighter API key (testnet only). */
export async function registerAgentApiKey(bot: LighterBotCredential, deps: RegistrationDeps): Promise<RegistrationResult> {
  const { config, store } = deps;
  if (config.network !== "testnet") {
    throw new LighterRegistrationError("mainnet_refused", "Lighter API-key registration is enabled on the Robinhood testnet environment only");
  }
  if (bot.agentChain !== "robinhood" || !bot.agentPublicKey || !isAddress(bot.agentPublicKey)) {
    throw new LighterRegistrationError("invalid_state", "Bot has no Robinhood agent wallet to own a Lighter account");
  }
  if (bot.lighterNetwork && bot.lighterNetwork !== config.network) {
    throw new LighterRegistrationError("invalid_state", `Bot's Lighter credential is for ${bot.lighterNetwork}, not ${config.network}`);
  }
  const client = deps.client ?? new LighterClient(config);
  await client.assertNetwork();

  const accountIndex = await resolveAgentLighterAccount(client, bot.agentPublicKey, bot.lighterAccountIndex);
  const apiKeyIndex = bot.lighterApiKeyIndex ?? DEFAULT_LIGHTER_API_KEY_INDEX;
  const target = { config, accountIndex, apiKeyIndex };
  const onChain = async (): Promise<LighterApiKeyRecord | undefined> =>
    (await client.getApiKeys(accountIndex, apiKeyIndex)).find((k) => k.apiKeyIndex === apiKeyIndex && k.publicKey && !/^0x0*$/.test(k.publicKey));

  const existing = await onChain();
  let signer: LighterSigner;
  let publicKey: string;

  if (bot.lighterApiPublicKey && bot.lighterApiKeyEnc) {
    if (existing && samePub(existing.publicKey, bot.lighterApiPublicKey)) {
      if (bot.lighterApiKeyStatus !== "registered") await store.markRegistered({ publicKey: bot.lighterApiPublicKey });
      return { accountIndex, apiKeyIndex, publicKey: bot.lighterApiPublicKey, status: "registered", reused: true };
    }
    if (existing) {
      throw new LighterRegistrationError(
        "slot_occupied",
        `API key slot ${apiKeyIndex} on account ${accountIndex} holds a different key; rotation must be an explicit operation`,
      );
    }
    // Pending (or lost) registration of OUR stored key: resubmit the same key.
    signer = await (deps.openSigner ?? LighterSigner.open)({ ...target, apiKeyEnc: bot.lighterApiKeyEnc });
    publicKey = bot.lighterApiPublicKey;
  } else {
    if (existing) {
      throw new LighterRegistrationError(
        "slot_occupied",
        `API key slot ${apiKeyIndex} on account ${accountIndex} is already in use by a key this bot does not hold; refusing to overwrite it`,
      );
    }
    const provisioned = await (deps.provisionSigner ?? LighterSigner.provision)(target);
    signer = provisioned.signer;
    publicKey = provisioned.publicKey;
    // Persist BEFORE submitting, so a retry reuses this exact key.
    await store.savePending({ network: config.network, accountIndex, apiKeyIndex, publicKey, apiKeyEnc: provisioned.apiKeyEnc });
  }

  try {
    const nonce = await (deps.nextNonce ?? httpNextNonce)(config, accountIndex, apiKeyIndex);
    const intent: ApiKeyRegistrationIntent = {
      network: config.network,
      lighterChainId: config.lighterChainId,
      l1Owner: getAddress(bot.agentPublicKey),
      accountIndex,
      apiKeyIndex,
      publicKeyHex: publicKey,
      nonce,
    };
    const prepared = await signer.prepareChangePubKey(`0x${normalizePubKey(publicKey)}`, nonce);
    verifyPreparedChangePubKey(prepared, intent);
    const l1Sig = await deps.signRegistration(bot, intent, prepared);
    const { txHash } = await (deps.sendTx ?? httpSendTx)(config, attachL1Sig(prepared, l1Sig));

    const attempts = deps.confirmAttempts ?? 20;
    for (let i = 0; i < attempts; i++) {
      const now = await onChain();
      if (now && samePub(now.publicKey, publicKey)) {
        await store.markRegistered({ publicKey });
        return { accountIndex, apiKeyIndex, publicKey, status: "registered", reused: false, txHash };
      }
      await new Promise((r) => setTimeout(r, deps.confirmDelayMs ?? 1_500));
    }
    throw new LighterRegistrationError("not_confirmed", `ChangePubKey ${txHash} submitted but the key is not yet visible on Lighter; re-run to reconcile (the same key will be reused)`);
  } finally {
    await signer.close();
  }
}
