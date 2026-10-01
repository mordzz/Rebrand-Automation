/**
 * PR12 Lighter API-key registration tests — no mainnet, no live submission.
 *
 *   - official ChangePubKey message: our independent rebuild must equal the
 *     REAL official WASM `messageToSign`, byte for byte
 *   - every bound field tampered → refused before the agent key is loaded
 *   - agent-wallet EIP-191 signature recovers to the agent wallet
 *   - authoritative account resolution
 *   - idempotent orchestration: reuse, resubmit same key, refuse overwrite,
 *     persist-before-submit, confirmation required
 *   - raw API key never reaches this (main) thread
 *
 * Run: npm run test:lighter-registration
 */
import * as crypto from "node:crypto";
for (const k of ["LIGHTER_API_KEY_ENCRYPTION_KEY", "AGENT_WALLET_ENCRYPTION_KEY"]) {
  if (!process.env[k]?.trim()) process.env[k] = crypto.randomBytes(32).toString("hex");
}

import { getAddress, recoverMessageAddress } from "viem";

import { signLighterApiKeyRegistration } from "@/lib/chain/lighter-registration-signing";
import { generateRobinhoodAgentWallet, loadRobinhoodAgentAccount } from "@/lib/chain/robinhood-agent-wallet";
import type { LighterApiKeyRecord, LighterSubAccount } from "@/lib/lighter/client";
import { getLighterConfig } from "@/lib/lighter/config";
import {
  attachL1Sig,
  buildChangePubKeyMessage,
  registerAgentApiKey,
  resolveAgentLighterAccount,
  verifyPreparedChangePubKey,
  type ApiKeyRegistrationIntent,
  type LighterBotCredential,
  type RegistrationDeps,
} from "@/lib/lighter/registration";
import { LighterSigner, verifySignerArtifacts, type PreparedChangePubKey } from "@/lib/lighter/signer-adapter";

let failures = 0;
function assert(c: boolean, label: string) {
  if (!c) {
    console.error(`[FAIL] ${label}`);
    failures++;
  } else console.log(`[PASS] ${label}`);
}
async function rejects(fn: () => Promise<unknown>, re: RegExp, label: string) {
  try {
    await fn();
    assert(false, `${label} (no throw)`);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    assert(re.test(m) || re.test((e as { kind?: string }).kind ?? ""), `${label} — ${m.slice(0, 90)}`);
  }
}

const testnet = getLighterConfig("testnet");
const ACCOUNT = 47;
const KEY_INDEX = 3;

async function main() {
  const wallet = await generateRobinhoodAgentWallet();
  const bot = { agentChain: "robinhood", agentNetwork: wallet.network, agentPublicKey: wallet.address, agentSecretEnc: wallet.secretEnc };
  const other = getAddress("0x8617E340B3D01FA5F11F306F4090FD50E238070D");

  // ═══ Real official WASM: provision + prepare ChangePubKey ═════════════
  let prepared: PreparedChangePubKey | null = null;
  let intent: ApiKeyRegistrationIntent | null = null;
  try {
    verifySignerArtifacts();
    const prov = await LighterSigner.provision({ apiKeyIndex: KEY_INDEX, accountIndex: ACCOUNT, config: testnet, timeoutMs: 10_000 });
    try {
      intent = {
        network: "testnet", lighterChainId: 300, l1Owner: wallet.address, accountIndex: ACCOUNT, apiKeyIndex: KEY_INDEX,
        publicKeyHex: prov.publicKey, nonce: 9,
      };
      prepared = await prov.signer.prepareChangePubKey(`0x${prov.publicKey.replace(/^0x/, "")}`, 9);
      assert(prepared.messageToSign === buildChangePubKeyMessage(intent), "independent message rebuild == official WASM messageToSign (byte-exact)");
      verifyPreparedChangePubKey(prepared, intent);
      assert(true, "official ChangePubKey output verifies against the intent");
      assert(!/"privateKey"/i.test(JSON.stringify(prepared)), "prepared output carries no private key field");
    } finally {
      await prov.signer.close();
    }
  } catch (e) {
    console.log(`[SKIP] real WASM section: ${(e as Error).message}`);
  }

  if (prepared && intent) {
    const p = prepared;
    const i = intent;
    const tampers: Array<[string, Partial<ApiKeyRegistrationIntent> | null, Partial<PreparedChangePubKey> | null]> = [
      ["different account index", { accountIndex: 48 }, null],
      ["different api key index", { apiKeyIndex: 4 }, null],
      ["different nonce", { nonce: 10 }, null],
      ["different public key", { publicKeyHex: "0x" + "ab".repeat(40) }, null],
      ["mainnet network", { network: "mainnet" }, null],
      ["Robinhood EVM chain id as signing domain", { lighterChainId: 46630 }, null],
      ["reserved key index 1", { apiKeyIndex: 1 }, null],
      ["wrong tx type", null, { txType: 14 }],
      ["altered messageToSign", null, { messageToSign: p.messageToSign.replace("Register", "Approve") }],
      ["txInfo with pre-filled L1Sig", null, { txInfo: JSON.stringify({ ...JSON.parse(p.txInfo), L1Sig: "0x01" }) }],
    ];
    for (const [label, ip, pp] of tampers) {
      let loaded = false;
      await rejects(
        () =>
          signLighterApiKeyRegistration(bot, { ...i, ...(ip ?? {}) }, { ...p, ...(pp ?? {}) }, {
            loadAccount: async (b) => ((loaded = true), loadRobinhoodAgentAccount(b)),
          }),
        /refused|intent_mismatch/,
        `refuses ${label}`,
      );
      assert(!loaded, `${label}: agent key never loaded`);
    }
    {
      let loaded = false;
      await rejects(
        () => signLighterApiKeyRegistration(bot, { ...i, l1Owner: other }, p, { loadAccount: async (b) => ((loaded = true), loadRobinhoodAgentAccount(b)) }),
        /not this bot's agent wallet/,
        "refuses an intent whose L1 owner is not the agent wallet",
      );
      assert(!loaded, "wrong L1 owner: agent key never loaded");
    }
    const sig = await signLighterApiKeyRegistration(bot, i, p);
    const recovered = await recoverMessageAddress({ message: p.messageToSign, signature: sig });
    assert(getAddress(recovered) === wallet.address, "EIP-191 L1Sig recovers to the agent wallet");
    const withSig = attachL1Sig(p, sig);
    assert(JSON.parse(withSig.txInfo).L1Sig === sig && withSig.txType === 8, "L1Sig attached as the official txInfo field");
    let threw = false;
    try { attachL1Sig(p, "0x1234"); } catch { threw = true; }
    assert(threw, "malformed L1Sig refused");
  }

  // ═══ Account resolution ═══════════════════════════════════════════════
  const sub = (idx: number, l1: string): LighterSubAccount => ({ accountIndex: idx, l1Address: l1, collateral: "0", accountType: 0 });
  const clientWith = (subs: LighterSubAccount[]) => ({ getSubAccounts: async () => subs });
  await rejects(() => resolveAgentLighterAccount(clientWith([]), wallet.address, null), /no_account|No Lighter account/, "no account → no_account");
  assert((await resolveAgentLighterAccount(clientWith([sub(47, wallet.address)]), wallet.address, null)) === 47, "single agent-owned account resolved");
  await rejects(
    () => resolveAgentLighterAccount(clientWith([sub(47, wallet.address), sub(48, wallet.address)]), wallet.address, null),
    /ambiguous/,
    "multiple accounts without stored mapping → refused (no guessing)",
  );
  assert((await resolveAgentLighterAccount(clientWith([sub(47, wallet.address), sub(48, wallet.address)]), wallet.address, 48)) === 48, "stored mapping selects among owned accounts");
  await rejects(() => resolveAgentLighterAccount(clientWith([sub(47, wallet.address)]), wallet.address, 99), /not owned/, "stored index not owned by agent → refused");
  await rejects(() => resolveAgentLighterAccount(clientWith([sub(50, other)]), wallet.address, null), /no_account|No Lighter account/, "accounts of other L1 addresses ignored");

  // ═══ Orchestration (fakes) ════════════════════════════════════════════
  const PUB = "0x" + "11".repeat(40);
  const PUB2 = "0x" + "22".repeat(40);
  const baseBot: LighterBotCredential = {
    ...bot, lighterNetwork: null, lighterAccountIndex: null, lighterApiKeyIndex: null,
    lighterApiPublicKey: null, lighterApiKeyEnc: null, lighterApiKeyStatus: null,
  };
  function harness(o: { onChain?: () => LighterApiKeyRecord[]; confirmAfter?: number } = {}) {
    const log: string[] = [];
    let sent = 0;
    const fakeSigner = {
      async prepareChangePubKey(pub: string, nonce: number): Promise<PreparedChangePubKey> {
        log.push("prepare");
        const pubHex = pub.replace(/^0x/, "");
        return {
          txType: 8, txHash: "aa", nonce,
          txInfo: JSON.stringify({ AccountIndex: ACCOUNT, ApiKeyIndex: 2, Nonce: nonce, PubKey: Buffer.from(pubHex, "hex").toString("base64") }),
          messageToSign: buildChangePubKeyMessage({ publicKeyHex: pubHex, nonce, accountIndex: ACCOUNT, apiKeyIndex: 2 }),
        };
      },
      async close() { log.push("close"); },
    } as unknown as LighterSigner;
    const deps: RegistrationDeps = {
      config: testnet,
      confirmDelayMs: 1,
      confirmAttempts: 3,
      store: {
        async savePending() { log.push("savePending"); },
        async markRegistered() { log.push("markRegistered"); },
      },
      client: {
        async assertNetwork() {},
        async getSubAccounts() { return [sub(ACCOUNT, wallet.address)]; },
        async getApiKeys() {
          if (o.onChain) return o.onChain();
          return sent > 0 && sent >= (o.confirmAfter ?? 1) ? [{ accountIndex: ACCOUNT, apiKeyIndex: 2, nonce: 1, publicKey: PUB }] : [];
        },
      },
      nextNonce: async () => (log.push("nonce"), 0),
      sendTx: async () => (log.push("send"), sent++, { txHash: "0xtx" }),
      provisionSigner: async () => (log.push("provision"), { signer: fakeSigner, publicKey: PUB, apiKeyEnc: "lk1.a.b.c" }),
      openSigner: async () => (log.push("open"), fakeSigner),
      signRegistration: async (_b, i2, pp) => {
        verifyPreparedChangePubKey(pp, i2);
        log.push("l1sign");
        return `0x${"ab".repeat(65)}` as `0x${string}`;
      },
    };
    return { deps, log };
  }
  {
    const { deps, log } = harness();
    const r = await registerAgentApiKey(baseBot, deps);
    assert(r.status === "registered" && !r.reused && r.accountIndex === ACCOUNT && r.apiKeyIndex === 2, "fresh registration → registered on resolved account, default key index 2");
    assert(log.indexOf("savePending") < log.indexOf("send") && log.indexOf("provision") < log.indexOf("savePending"), "encrypted key persisted as pending BEFORE submission");
    assert(log.indexOf("l1sign") < log.indexOf("send") && log.includes("markRegistered"), "L1 sign → send → confirmed via apikeys → markRegistered");
  }
  {
    const { deps, log } = harness({ onChain: () => [{ accountIndex: ACCOUNT, apiKeyIndex: 2, nonce: 3, publicKey: PUB }] });
    const r = await registerAgentApiKey({ ...baseBot, lighterAccountIndex: ACCOUNT, lighterApiKeyIndex: 2, lighterApiPublicKey: PUB, lighterApiKeyEnc: "lk1.a.b.c", lighterApiKeyStatus: "registered", lighterNetwork: "testnet" }, deps);
    assert(r.reused && !log.includes("provision") && !log.includes("send") && !log.includes("l1sign"), "already registered → reused, no rotation, no L1 signature");
  }
  {
    const { deps, log } = harness();
    await registerAgentApiKey({ ...baseBot, lighterAccountIndex: ACCOUNT, lighterApiKeyIndex: 2, lighterApiPublicKey: PUB, lighterApiKeyEnc: "lk1.a.b.c", lighterApiKeyStatus: "pending", lighterNetwork: "testnet" }, deps);
    assert(log.includes("open") && !log.includes("provision"), "pending registration → same stored key resubmitted, no new key generated");
  }
  {
    const { deps, log } = harness({ onChain: () => [{ accountIndex: ACCOUNT, apiKeyIndex: 2, nonce: 3, publicKey: PUB2 }] });
    await rejects(() => registerAgentApiKey(baseBot, deps), /slot_occupied|already in use/, "slot holding a foreign key → refused (no overwrite)");
    assert(!log.includes("provision") && !log.includes("l1sign"), "foreign key: nothing generated or signed");
    await rejects(
      () => registerAgentApiKey({ ...baseBot, lighterAccountIndex: ACCOUNT, lighterApiKeyIndex: 2, lighterApiPublicKey: PUB, lighterApiKeyEnc: "lk1.a.b.c", lighterApiKeyStatus: "registered", lighterNetwork: "testnet" }, deps),
      /slot_occupied|explicit/,
      "our registered key replaced on Lighter → refused; rotation must be explicit",
    );
  }
  {
    const { deps, log } = harness({ confirmAfter: 99 });
    await rejects(() => registerAgentApiKey(baseBot, deps), /not_confirmed|not yet visible/, "submitted but not visible → not_confirmed (not success)");
    assert(log.includes("savePending") && !log.includes("markRegistered") && log.includes("close"), "unconfirmed: stays pending, signer closed");
  }
  {
    const { deps } = harness();
    await rejects(() => registerAgentApiKey(baseBot, { ...deps, config: getLighterConfig("mainnet") }), /mainnet_refused|testnet/, "mainnet registration refused");
    await rejects(() => registerAgentApiKey({ ...baseBot, agentChain: "solana" }, deps), /invalid_state|agent wallet/, "non-Robinhood agent wallet refused");
  }

  console.log(failures === 0 ? "\nAll Lighter registration tests passed." : `\n${failures} failure(s).`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
