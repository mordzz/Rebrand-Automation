/**
 * Lighter foundation, API key registration and execution (offline).
 *
 * Consolidated from: test-lighter-foundation.ts, test-lighter-registration.ts, test-lighter-execution.ts.
 * Each original suite runs in its own function scope.
 */
import * as crypto from "node:crypto";
for (const k of ["LIGHTER_API_KEY_ENCRYPTION_KEY", "AGENT_WALLET_ENCRYPTION_KEY"]) {
  if (!process.env[k]?.trim()) process.env[k] = crypto.randomBytes(32).toString("hex");
}
if (!process.env.LIGHTER_API_KEY_ENCRYPTION_KEY?.trim()) {
  process.env.LIGHTER_API_KEY_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
}

import { ROBINHOOD_CHAIN_IDS, ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { LighterApiError, LighterClient, parseAccount, parseMarket, type LighterApiKeyRecord, type LighterSubAccount, type LighterMarket } from "@/lib/lighter/client";
import { getLighterConfig } from "@/lib/lighter/config";
import { parseAccountFrame, streamUrl, subscribeAccount } from "@/lib/lighter/websocket";
import { getAddress, recoverMessageAddress } from "viem";
import { signLighterApiKeyRegistration } from "@/lib/chain/lighter-registration-signing";
import { generateRobinhoodAgentWallet, loadRobinhoodAgentAccount } from "@/lib/chain/robinhood-agent-wallet";
import { attachL1Sig, buildChangePubKeyMessage, registerAgentApiKey, resolveAgentLighterAccount, verifyPreparedChangePubKey, type ApiKeyRegistrationIntent, type LighterBotCredential, type RegistrationDeps } from "@/lib/lighter/registration";
import { LighterSigner, verifySignerArtifacts, type PreparedChangePubKey, LIGHTER_TX_TYPE, LighterSignerError, type SignerTransport } from "@/lib/lighter/signer-adapter";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LighterExecutor, LighterOrderError, scaleOrderIntent, type PerpOrderIntent } from "@/lib/lighter/orders";
import { leverageToInitialMarginFraction, scaleDecimal, unscaleInteger } from "@/lib/lighter/precision";
import { positionSide, toPerpAccountView } from "@/lib/lighter/positions";

async function lighter_foundation(): Promise<void> {
  let failures = 0;
  function assert(condition: boolean, label: string): void {
    if (!condition) {
      console.error(`[FAIL] ${label}`);
      failures++;
    } else {
      console.log(`[PASS] ${label}`);
    }
  }

  const fake = (routes: Record<string, { status?: number; body: unknown }>) => async (url: string) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`network down: ${url}`);
    return new Response(JSON.stringify(hit[1].body), { status: hit[1].status ?? 200 });
  };

  async function main() {
    // ═══ Config ═══════════════════════════════════════════════════════════
    const t = getLighterConfig("testnet");
    const m = getLighterConfig("mainnet");
    assert(t.apiBaseUrl.includes("rh-testnet") && !m.apiBaseUrl.includes("testnet"), "testnet/mainnet API hosts are distinct");
    assert(t.lighterChainId === 300 && m.lighterChainId === 466324, "Lighter L2 chain ids per docs");
    assert(
      t.lighterChainId !== ROBINHOOD_CHAIN_IDS.testnet && m.lighterChainId !== ROBINHOOD_CHAIN_IDS.mainnet,
      "Lighter chain ids are never confused with Robinhood EVM chain ids",
    );
    assert(getLighterConfig().network === ROBINHOOD_NETWORK, "Lighter network follows active Robinhood network");

    // ═══ Parsing ══════════════════════════════════════════════════════════
    const mk = parseMarket({
      symbol: "ETH", market_id: 0, market_type: "perp", status: "active", size_decimals: 4, price_decimals: 2,
      min_base_amount: "0.0050", min_quote_amount: "10.000000", min_initial_margin_fraction: 200,
      maintenance_margin_fraction: 120, mark_price: "4012.55", index_price: "4011.90", daily_price_change: -1.5, open_interest: 12,
    });
    assert(mk?.maxLeverage === 50, "max leverage = 10000 / min_initial_margin_fraction");
    assert(mk?.markPrice === "4012.55", "prices stay decimal strings");
    assert(parseMarket({ symbol: "X", market_id: 1, market_type: "spot" }) === null, "spot markets excluded from perps");

    const acct = parseAccount({
      account_index: 47, l1_address: "0xabc", collateral: "500.000000", available_balance: "480.5", total_asset_value: "500",
      assets: [
        { symbol: "ETH", margin_mode: "disabled", margin_balance: "0" },
        { symbol: "USDG", margin_mode: "enabled", margin_balance: "500.000000" },
      ],
      positions: [{ market_id: 0, symbol: "ETH", sign: -1, position: "0.5", avg_entry_price: "4000", unrealized_pnl: "-6.2", realized_pnl: "0", liquidation_price: "4800" }],
    });
    assert(acct.collateralAssets.length === 1 && acct.collateralAssets[0].symbol === "USDG", "collateral = margin-enabled asset, read not assumed");
    assert(acct.positions[0].size === "0.5" && acct.positions[0].sign === -1, "position size and raw sign passed through uninterpreted");

    // ═══ Client behaviour (fake fetcher) ══════════════════════════════════
    {
      const c = new LighterClient(t, fake({ "/info": { body: { contract_address: t.rollupContract.toLowerCase() } } }));
      await c.assertNetwork();
      assert(true, "rollup contract matches (case-insensitive) → network ok");
    }
    {
      const c = new LighterClient(t, fake({ "/info": { body: { contract_address: m.rollupContract } } }));
      let kind = "";
      try { await c.assertNetwork(); } catch (e) { kind = e instanceof LighterApiError ? e.kind : "?"; }
      assert(kind === "wrong_network", "mainnet rollup on testnet config → wrong_network");
    }
    {
      const c = new LighterClient(t, fake({ accountsByL1Address: { status: 400, body: { code: 21100, message: "account not found" } } }));
      const subs = await c.getSubAccounts("0x0000000000000000000000000000000000000002");
      assert(subs.length === 0, "unknown L1 address → no sub-accounts (not an error)");
    }
    {
      const c = new LighterClient(t, fake({}));
      let kind = "";
      try { await c.getMarkets(); } catch (e) { kind = e instanceof LighterApiError ? e.kind : "?"; }
      assert(kind === "unavailable", "network failure → unavailable (fail closed)");
    }
    {
      const c = new LighterClient(t, fake({}));
      let threw = false;
      try { await c.getSubAccounts("not-an-address"); } catch { threw = true; }
      assert(threw, "non-EVM L1 address refused before any request");
    }

    // ═══ Authed/public read endpoints (fake fetcher) ══════════════════════
    {
      const seen: Array<{ url: string; auth?: string }> = [];
      const c = new LighterClient(t, async (url, headers) => {
        seen.push({ url, auth: headers?.authorization });
        if (url.includes("accountActiveOrders")) return new Response(JSON.stringify({ code: 200, orders: [{ order_index: 281474976710656, client_order_index: 7, market_index: 0, is_ask: true, type: "limit", time_in_force: "good-till-time", reduce_only: false, price: "4050.00", initial_base_amount: "0.1000", remaining_base_amount: "0.1000", filled_base_amount: "0", status: "open" }] }));
        if (url.includes("apikeys")) return new Response(JSON.stringify({ code: 200, api_keys: [{ account_index: 47, api_key_index: 2, nonce: 4, public_key: "0xab" }] }));
        if (url.includes("positionFunding")) return new Response(JSON.stringify({ code: 200, position_fundings: [{ timestamp: 1, market_id: 0, change: "-0.01", rate: "0.0001", position_size: "0.1", position_side: "long" }] }));
        return new Response(JSON.stringify({ code: 200, fundings: [{ timestamp: 1, value: "0.03", rate: "0.0012", direction: "long" }] }));
      });
      const orders = await c.getActiveOrders(47, "tok123");
      assert(orders[0].orderIndex === 281474976710656 && orders[0].isAsk && orders[0].price === "4050.00", "active orders parsed (official Order fields)");
      assert(seen[0].auth === "tok123", "active orders sent with authorization header, not in URL");
      assert(!seen[0].url.includes("tok123"), "auth token never placed in the URL");
      assert((await c.getApiKeys(47, 2))[0].publicKey === "0xab", "api keys parsed");
      const empty = new LighterClient(t, fake({ apikeys: { status: 400, body: { code: 21200, message: "api key not found" } } }));
      assert((await empty.getApiKeys(47, 9)).length === 0, "empty key slot (\"api key not found\") → [] not an error");
      assert((await c.getPositionFunding(47, "tok123"))[0].change === "-0.01", "position funding parsed");
      assert((await c.getFundingRates(0))[0].rate === "0.0012", "funding rates parsed");
    }

    // ═══ WebSocket (official account_all channel) ═════════════════════════
    assert(streamUrl(t) === "wss://api.rh-testnet.lighter.xyz/stream", "stream URL per official client (/stream)");
    assert(parseAccountFrame(JSON.stringify({ type: "update/account_all", channel: "account_all:47", account: 47, positions: {} }), 47)?.kind === "update", "update frame parsed");
    assert(parseAccountFrame(JSON.stringify({ type: "subscribed/account_all", channel: "account_all:47" }), 47)?.kind === "snapshot", "snapshot frame parsed");
    assert(parseAccountFrame(JSON.stringify({ type: "update/account_all", account: 48 }), 47) === null, "other account's frame ignored");
    assert(parseAccountFrame("not json", 47) === null && parseAccountFrame(JSON.stringify({ type: "connected" }), 47) === null, "non-account frames ignored");
    {
      const sent: string[] = [];
      class FakeWS {
        onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null; onerror = null; onclose: (() => void) | null = null;
        constructor(readonly url: string) { setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ type: "update/account_all", account: 47 }) }); }, 0); }
        send(m: string) { sent.push(m); }
        close() {}
      }
      const got: string[] = [];
      const sub = subscribeAccount(47, (m) => got.push(m.kind), { config: t, WebSocketImpl: FakeWS as unknown as typeof WebSocket });
      await new Promise((r) => setTimeout(r, 20));
      sub.close();
      assert(sent.length === 1 && JSON.parse(sent[0]).channel === "account_all/47", "subscribes only to account_all/<index>");
      assert(got.join() === "update", "stream delivers account updates");
    }

    console.log(failures === 0 ? "\nAll Lighter foundation tests passed." : `\n${failures} failure(s).`);
    if (failures !== 0) process.exitCode = 1;
  }


  await main();
}

async function lighter_registration(): Promise<void> {
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
      assert(re.test(m) || re.test((e as { kind?: string }).kind ?? ""), `${label} - ${m.slice(0, 90)}`);
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
    if (failures !== 0) process.exitCode = 1;
  }


  await main();
}

async function lighter_execution(): Promise<void> {
  let failures = 0;
  function assert(c: boolean, label: string) {
    if (!c) {
      console.error(`[FAIL] ${label}`);
      failures++;
    } else console.log(`[PASS] ${label}`);
  }
  async function rejects(fn: () => Promise<unknown>, check: (e: unknown) => boolean, label: string) {
    try {
      await fn();
      assert(false, `${label} (no throw)`);
    } catch (e) {
      assert(check(e), `${label} - ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
  }
  const kind = (k: string) => (e: unknown) => (e as { kind?: string }).kind === k;

  const testnet = getLighterConfig("testnet");
  const ETH: LighterMarket = {
    marketId: 0, symbol: "ETH", status: "active", sizeDecimals: 4, priceDecimals: 2, minBaseAmount: "0.0050",
    minQuoteAmount: "10", maxLeverage: 50, maintenanceMarginFraction: 120, markPrice: "4000", indexPrice: "4000",
    dailyPriceChangePct: 0, openInterest: "0",
  };
  const baseIntent: PerpOrderIntent = {
    market: ETH, side: "sell", type: "limit", size: "0.1", price: "4050", reduceOnly: false, timeInForce: "gtt", clientOrderIndex: 7,
  };
  const ENC = "lk1.fake.fake.fake";

  /** Fake transport that behaves like the official signer echoing fields. */
  function fakeTransport(opts: { hang?: boolean; override?: (op: string, args: number[]) => Record<string, unknown> } = {}) {
    const calls: Array<{ op: string; payload: Record<string, unknown> }> = [];
    const t: SignerTransport = {
      async call(op, payload, timeoutMs) {
        calls.push({ op, payload });
        if (opts.hang) {
          await new Promise((r) => setTimeout(r, timeoutMs + 20));
          throw new LighterSignerError("timeout", `Lighter signer "${op}" timed out after ${timeoutMs}ms`);
        }
        if (op === "init") return {};
        const a = payload.args as number[];
        if (opts.override) return opts.override(op, a);
        if (op === "createOrder") {
          return { txType: 14, txHash: "ab12", txInfo: JSON.stringify({ AccountIndex: a[18], ApiKeyIndex: a[17], Nonce: a[16], MarketIndex: a[0], ClientOrderIndex: a[1], BaseAmount: a[2], Price: a[3], IsAsk: a[4], Type: a[5], TimeInForce: a[6], ReduceOnly: a[7] }) };
        }
        if (op === "cancelOrder") return { txType: 15, txHash: "cd34", txInfo: JSON.stringify({ AccountIndex: a[5], ApiKeyIndex: a[4], Nonce: a[3], MarketIndex: a[0], Index: a[1] }) };
        return { error: "unsupported in fake" };
      },
      async close() {},
    };
    return { t, calls };
  }

  async function main() {
    // ═══ 1. Precision + intent validation ═════════════════════════════════
    assert(scaleDecimal("0.1", 4, "s") === BigInt(1000), "size scaling: 0.1 @4dp → 1000 (official example)");
    assert(scaleDecimal("4050", 2, "p") === BigInt(405000), "price scaling: 4050 @2dp → 405000 (official example)");
    assert(scaleDecimal("0.10000", 4, "s") === BigInt(1000), "trailing zeros beyond precision allowed");
    for (const bad of ["0.00001", "-1", "1e3", "abc", ""]) {
      let threw = false;
      try { scaleDecimal(bad, 4, "s"); } catch { threw = true; }
      assert(threw, `refuses "${bad}" (over-precision / negative / non-decimal)`);
    }
    assert(unscaleInteger(BigInt(405000), 2) === "4050", "unscale round-trip");
    assert(leverageToInitialMarginFraction(10) === 1000 && leverageToInitialMarginFraction(3) === 3333, "leverage → imf = floor(10000/lev) (official SDK)");

    const s = scaleOrderIntent(baseIntent, 5);
    assert(s.isAsk === 1 && scaleOrderIntent({ ...baseIntent, side: "buy" }, 5).isAsk === 0, "side: sell → is_ask 1, buy → 0");
    assert(s.orderType === 0 && s.timeInForce === 1 && s.orderExpiry === -1, "limit GTT → type 0, TIF 1, official 28d default expiry");
    const mkt = scaleOrderIntent({ ...baseIntent, type: "market", timeInForce: "ioc" }, 5);
    assert(mkt.orderType === 1 && mkt.timeInForce === 0 && mkt.orderExpiry === 0, "market → type 1, IOC, expiry 0 (official DEFAULT_IOC_EXPIRY)");
    assert(scaleOrderIntent({ ...baseIntent, reduceOnly: true }, 5).reduceOnly === 1, "reduce-only maps to 1");
    const bad: Array<[string, Partial<PerpOrderIntent>]> = [
      ["invalid market id", { market: { ...ETH, marketId: -1 } }],
      ["inactive market", { market: { ...ETH, status: "frozen" } }],
      ["below minimum size", { size: "0.001" }],
      ["size over precision", { size: "0.12345" }],
      ["price over precision", { price: "4050.123" }],
      ["zero price", { price: "0" }],
      ["market order not IOC", { type: "market", timeInForce: "gtt" }],
      ["post-only market order", { type: "market", timeInForce: "post_only" }],
      ["client order index 0", { clientOrderIndex: 0 }],
      ["client order index > 2^48-1", { clientOrderIndex: 2 ** 48 }],
      ["invalid side", { side: "long" as never }],
    ];
    for (const [label, patch] of bad) {
      let k = "";
      try { scaleOrderIntent({ ...baseIntent, ...patch }, 5); } catch (e) { k = (e as LighterOrderError).kind; }
      assert(k === "invalid_intent", `refuses ${label}`);
    }

    // ═══ 2. Signer adapter (fake transport) ═══════════════════════════════
    await rejects(
      () => LighterSigner.open({ apiKeyEnc: ENC, apiKeyIndex: 3, accountIndex: 1, config: { ...testnet, lighterChainId: 46630 }, transport: fakeTransport().t }),
      kind("wrong_domain"),
      "Robinhood EVM chain id as Lighter signing domain → refused",
    );
    await rejects(
      () => LighterSigner.open({ apiKeyEnc: ENC, apiKeyIndex: 3, accountIndex: 1, config: { ...testnet, lighterChainId: 466324 }, transport: fakeTransport().t }),
      kind("wrong_domain"),
      "mainnet signing domain on testnet config → refused",
    );
    await rejects(
      () => LighterSigner.open({ apiKeyEnc: ENC, apiKeyIndex: 0, accountIndex: 1, config: testnet, transport: fakeTransport().t }),
      (e) => e instanceof LighterSignerError,
      "reserved API key index 0 refused",
    );
    await rejects(
      () => LighterSigner.open({ apiKeyEnc: ENC, apiKeyIndex: 3, accountIndex: 1, config: testnet, artifactDir: join(process.cwd(), "does-not-exist") }),
      kind("unavailable"),
      "missing signer artifacts → unavailable",
    );
    {
      const signer = await LighterSigner.open({ apiKeyEnc: ENC, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: fakeTransport({ hang: true }).t, timeoutMs: 30 }).catch((e) => e);
      assert(signer instanceof LighterSignerError && signer.kind === "timeout", "signer timeout surfaces as timeout");
    }
    {
      const { t } = fakeTransport({ override: () => ({ txType: 14, txHash: "ab", txInfo: JSON.stringify({ AccountIndex: 1, ApiKeyIndex: 3, Nonce: 5, MarketIndex: 0, ClientOrderIndex: 7, BaseAmount: 999999, Price: 405000, IsAsk: 1, Type: 0, TimeInForce: 1, ReduceOnly: 0 }) }) });
      const signer = await LighterSigner.open({ apiKeyEnc: ENC, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: t });
      await rejects(() => signer.createOrder(s), kind("malformed_output"), "signed amount differs from intent → malformed_output");
    }
    {
      const { t } = fakeTransport({ override: () => ({ txType: 15, txHash: "ab", txInfo: "{}" }) });
      const signer = await LighterSigner.open({ apiKeyEnc: ENC, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: t });
      await rejects(() => signer.createOrder(s), kind("malformed_output"), "wrong tx type → malformed_output");
    }
    {
      const { t } = fakeTransport({ override: () => ({ txType: 14, txHash: "ab", txInfo: "not json" }) });
      const signer = await LighterSigner.open({ apiKeyEnc: ENC, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: t });
      await rejects(() => signer.createOrder(s), kind("malformed_output"), "non-JSON txInfo → malformed_output");
    }
    {
      const { t } = fakeTransport({ override: () => ({ error: "boom" }) });
      const signer = await LighterSigner.open({ apiKeyEnc: ENC, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: t });
      await rejects(() => signer.createOrder(s), kind("signer_error"), "signer error propagates as signer_error");
    }
    {
      const proto = Object.getOwnPropertyNames(LighterSigner.prototype);
      assert(!proto.some((n) => /arbitrary|raw|bytes|payload/i.test(n)) && proto.includes("createOrder"), "no generic/arbitrary sign method on the adapter");
      const worker = readFileSync(join(process.cwd(), "lib/lighter/signer-worker.cjs"), "utf8");
      assert(/const OPS = \{[\s\S]*?\};/.test(worker) && !/globalThis\[msg\.op\]/.test(worker), "worker only dispatches a fixed op whitelist");
    }

    // ═══ 3. Executor ══════════════════════════════════════════════════════
    const okClient = { assertNetwork: async () => {} } as unknown as LighterClient;
    async function executor(opts: { sendFail?: number; transport?: SignerTransport; client?: LighterClient } = {}) {
      const { t, calls } = fakeTransport();
      const signer = await LighterSigner.open({ apiKeyEnc: ENC, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: opts.transport ?? t });
      let nonceFetches = 0;
      let sends = 0;
      const ex = new LighterExecutor(signer, {
        client: opts.client ?? okClient,
        nextNonce: async () => (nonceFetches++, 40),
        sendTx: async (_c, signed) => {
          sends++;
          if (opts.sendFail && sends <= opts.sendFail) throw new LighterOrderError("api_error", "Lighter rejected tx: invalid nonce");
          return { txHash: signed.txHash };
        },
      });
      return { ex, calls, stats: () => ({ nonceFetches, sends }) };
    }
    {
      const { ex, calls, stats } = await executor();
      const a = await ex.createOrder(baseIntent);
      const b = await ex.createOrder({ ...baseIntent, clientOrderIndex: 8 });
      assert(a.nonce === 40 && b.nonce === 41 && stats().nonceFetches === 1, "nonce fetched once, then incremented locally");
      const signedArgs = calls.filter((c) => c.op === "createOrder").map((c) => (c.payload.args as number[])[16]);
      assert(signedArgs.join() === "40,41", "explicit nonce passed to signer (never -1 auto-fetch)");
      await rejects(() => ex.createOrder(baseIntent), kind("replay"), "duplicate clientOrderIndex refused (replay)");
    }
    {
      const { ex, stats } = await executor({ sendFail: 1 });
      await rejects(() => ex.createOrder(baseIntent), kind("api_error"), "API error propagates");
      await ex.createOrder({ ...baseIntent, clientOrderIndex: 9 });
      assert(stats().nonceFetches === 2, "nonce resynced from Lighter after a failure");
    }
    {
      const wrong = { assertNetwork: async () => { throw new LighterApiError("wrong_network", "rollup mismatch"); } } as unknown as LighterClient;
      const { ex, stats } = await executor({ client: wrong });
      await rejects(() => ex.createOrder(baseIntent), kind("wrong_network"), "Lighter network mismatch → refused");
      assert(stats().sends === 0, "network mismatch: nothing sent");
    }
    {
      const { ex, stats } = await executor();
      await rejects(() => ex.createOrder({ ...baseIntent, size: "0.001" }), kind("invalid_intent"), "invalid intent refused before nonce/network");
      assert(stats().nonceFetches === 0, "invalid intent: no nonce consumed");
      await rejects(() => ex.updateLeverage(ETH, 51, "cross"), kind("invalid_intent"), "leverage above market max refused");
      await rejects(() => ex.updateLeverage(ETH, 0, "cross"), kind("invalid_intent"), "leverage 0 refused");
    }
    {
      const signer = await LighterSigner.open({ apiKeyEnc: ENC, apiKeyIndex: 3, accountIndex: 1, config: getLighterConfig("mainnet"), transport: fakeTransport().t });
      let k = "";
      try { new LighterExecutor(signer); } catch (e) { k = (e as LighterOrderError).kind; }
      assert(k === "mainnet_refused", "mainnet executor refused (no mainnet orders)");
    }

    // ═══ Positions ════════════════════════════════════════════════════════
    assert(positionSide({ sign: 1, size: "0.5" }) === "long" && positionSide({ sign: -1, size: "0.5" }) === "short", "sign 1 → long, -1 → short (official example)");
    assert(positionSide({ sign: 7, size: "0.5" }) === "unknown" && positionSide({ sign: 1, size: "0.000" }) === "flat", "unknown sign not guessed; zero size flat");
    const view = toPerpAccountView({
      accountIndex: 1, l1Address: "0x", collateral: "500", availableBalance: "480", totalAssetValue: "495",
      collateralAssets: [{ symbol: "USDC", marginBalance: "500" }],
      positions: [
        { marketId: 0, symbol: "ETH", size: "0.5", sign: -1, avgEntryPrice: "4000", unrealizedPnl: "-5", realizedPnl: "1.25", liquidationPrice: "4800", totalFundingPaidOut: "0.3", allocatedMargin: "0", marginMode: 0 },
        { marketId: 1, symbol: "BTC", size: "0", sign: 1, avgEntryPrice: "0", unrealizedPnl: "0", realizedPnl: "3", liquidationPrice: null, totalFundingPaidOut: "0", allocatedMargin: "0", marginMode: 1 },
      ],
    });
    assert(view.positions.length === 1 && view.positions[0].unrealizedPnl === "-5" && view.positions[0].realizedPnl === "1.25", "PnL strings preserved; flat positions hidden");

    // ═══ 4. Real official WASM ════════════════════════════════════════════
    try {
      verifySignerArtifacts();
    } catch (e) {
      console.log(`[SKIP] official WASM not built (${(e as Error).message}) - run scripts/build-lighter-signer.sh`);
      return finish();
    }
    {
      // Throwaway, unregistered key generated INSIDE the worker by the
      // official GenerateAPIKey; this thread only ever sees public + encrypted.
      const prov = await LighterSigner.provision({ apiKeyIndex: 3, accountIndex: 47, config: testnet, timeoutMs: 10_000 });
      await prov.signer.close();
      assert(/^(0x)?[0-9a-f]{80}$/i.test(prov.publicKey) && prov.apiKeyEnc.startsWith("lk1."), "real WASM: provision returns only public key + encrypted blob");
      const signer = await LighterSigner.open({ apiKeyEnc: prov.apiKeyEnc, apiKeyIndex: 3, accountIndex: 47, config: testnet, timeoutMs: 10_000 });
      await rejects(
        () => LighterSigner.open({ apiKeyEnc: prov.apiKeyEnc, apiKeyIndex: 4, accountIndex: 47, config: testnet, timeoutMs: 10_000 }),
        (e) => /different account\/key index/.test((e as Error).message),
        "real WASM: encrypted key cannot be replayed onto another key slot (AAD binding)",
      );
      try {
        const order = await signer.createOrder(scaleOrderIntent(baseIntent, 12));
        assert(order.txType === LIGHTER_TX_TYPE.createOrder && order.txHash.length > 0, "real WASM: create order signed, fields cross-checked");
        const info = JSON.parse(order.txInfo) as Record<string, unknown>;
        assert(typeof info.Sig === "string" && (info.Sig as string).length > 0, "real WASM: signature present");
        const token = await signer.createAuthToken(Math.floor(Date.now() / 1000) + 600);
        assert(token.length > 10, "real WASM: auth token created with API key");
        await rejects(() => signer.createAuthToken(Math.floor(Date.now() / 1000) + 9 * 3600), (e) => e instanceof LighterSignerError, "auth token beyond 8h refused");
        const cancel = await signer.cancelOrder({ marketIndex: 0, orderIndex: 123, nonce: 13 });
        assert(cancel.txType === LIGHTER_TX_TYPE.cancelOrder, "real WASM: cancel signed, fields cross-checked");
        const modify = await signer.modifyOrder({ marketIndex: 0, orderIndex: 123, baseAmount: 2000, price: 406000, nonce: 14 });
        assert(modify.txType === LIGHTER_TX_TYPE.modifyOrder, "real WASM: modify signed, fields cross-checked");
        const lev = await signer.updateLeverage({ marketIndex: 0, initialMarginFraction: 1000, marginMode: 0, nonce: 15 });
        assert(lev.txType === LIGHTER_TX_TYPE.updateLeverage, "real WASM: leverage signed, fields cross-checked");
        await rejects(
          () => signer.createOrder({ ...scaleOrderIntent(baseIntent, 16), marketIndex: 40000 }),
          (e) => e instanceof LighterSignerError,
          "real WASM: out-of-range market refused",
        );
      } finally {
        await signer.close();
      }
    }
    return finish();
  }

  function finish() {
    console.log(failures === 0 ? "\nAll Lighter execution tests passed." : `\n${failures} failure(s).`);
    if (failures !== 0) process.exitCode = 1;
  }


  await main();
}

async function runAll(): Promise<void> {
  console.log("\n=== lighter-foundation ===");
  try {
    await lighter_foundation();
  } catch (error) {
    console.error("[FAIL] test-lighter-foundation threw:", error);
    process.exitCode = 1;
  }
  console.log("\n=== lighter-registration ===");
  try {
    await lighter_registration();
  } catch (error) {
    console.error("[FAIL] test-lighter-registration threw:", error);
    process.exitCode = 1;
  }
  console.log("\n=== lighter-execution ===");
  try {
    await lighter_execution();
  } catch (error) {
    console.error("[FAIL] test-lighter-execution threw:", error);
    process.exitCode = 1;
  }
}

void runAll();
