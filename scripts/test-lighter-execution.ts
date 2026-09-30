/**
 * PR12 Lighter execution tests — deterministic, no mainnet, no submission
 * to any live venue.
 *
 *   1. precision / intent validation (pure)
 *   2. signer adapter with a fake transport: domain binding, timeout,
 *      unavailable, malformed output, no arbitrary-sign path, key redaction
 *   3. executor: nonce handling, resync after failure, replay refusal,
 *      API error, network mismatch, mainnet refusal
 *   4. REAL official WASM (pinned checksum) signing with a throwaway,
 *      unregistered API key — output parsed and cross-checked; never sent
 *
 * Run: npm run test:lighter-execution
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LighterApiError, type LighterClient, type LighterMarket } from "@/lib/lighter/client";
import { getLighterConfig } from "@/lib/lighter/config";
import { LighterExecutor, LighterOrderError, scaleOrderIntent, type PerpOrderIntent } from "@/lib/lighter/orders";
import { leverageToInitialMarginFraction, scaleDecimal, unscaleInteger } from "@/lib/lighter/precision";
import { positionSide, toPerpAccountView } from "@/lib/lighter/positions";
import { LIGHTER_TX_TYPE, LighterSigner, LighterSignerError, verifySignerArtifacts, type SignerTransport } from "@/lib/lighter/signer-adapter";

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
    assert(check(e), `${label} — ${e instanceof Error ? e.message.slice(0, 80) : e}`);
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
const API_KEY = "a".repeat(80);

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
    () => LighterSigner.open({ apiPrivateKey: API_KEY, apiKeyIndex: 3, accountIndex: 1, config: { ...testnet, lighterChainId: 46630 }, transport: fakeTransport().t }),
    kind("wrong_domain"),
    "Robinhood EVM chain id as Lighter signing domain → refused",
  );
  await rejects(
    () => LighterSigner.open({ apiPrivateKey: API_KEY, apiKeyIndex: 3, accountIndex: 1, config: { ...testnet, lighterChainId: 466324 }, transport: fakeTransport().t }),
    kind("wrong_domain"),
    "mainnet signing domain on testnet config → refused",
  );
  await rejects(
    () => LighterSigner.open({ apiPrivateKey: API_KEY, apiKeyIndex: 0, accountIndex: 1, config: testnet, transport: fakeTransport().t }),
    (e) => e instanceof LighterSignerError,
    "reserved API key index 0 refused",
  );
  await rejects(
    () => LighterSigner.open({ apiPrivateKey: API_KEY, apiKeyIndex: 3, accountIndex: 1, config: testnet, artifactDir: join(process.cwd(), "does-not-exist") }),
    kind("unavailable"),
    "missing signer artifacts → unavailable",
  );
  {
    const signer = await LighterSigner.open({ apiPrivateKey: API_KEY, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: fakeTransport({ hang: true }).t, timeoutMs: 30 }).catch((e) => e);
    assert(signer instanceof LighterSignerError && signer.kind === "timeout", "signer timeout surfaces as timeout");
  }
  {
    const { t } = fakeTransport({ override: () => ({ txType: 14, txHash: "ab", txInfo: JSON.stringify({ AccountIndex: 1, ApiKeyIndex: 3, Nonce: 5, MarketIndex: 0, ClientOrderIndex: 7, BaseAmount: 999999, Price: 405000, IsAsk: 1, Type: 0, TimeInForce: 1, ReduceOnly: 0 }) }) });
    const signer = await LighterSigner.open({ apiPrivateKey: API_KEY, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: t });
    await rejects(() => signer.createOrder(s), kind("malformed_output"), "signed amount differs from intent → malformed_output");
  }
  {
    const { t } = fakeTransport({ override: () => ({ txType: 15, txHash: "ab", txInfo: "{}" }) });
    const signer = await LighterSigner.open({ apiPrivateKey: API_KEY, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: t });
    await rejects(() => signer.createOrder(s), kind("malformed_output"), "wrong tx type → malformed_output");
  }
  {
    const { t } = fakeTransport({ override: () => ({ txType: 14, txHash: "ab", txInfo: "not json" }) });
    const signer = await LighterSigner.open({ apiPrivateKey: API_KEY, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: t });
    await rejects(() => signer.createOrder(s), kind("malformed_output"), "non-JSON txInfo → malformed_output");
  }
  {
    const { t } = fakeTransport({ override: () => ({ error: "boom" }) });
    const signer = await LighterSigner.open({ apiPrivateKey: API_KEY, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: t });
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
    const signer = await LighterSigner.open({ apiPrivateKey: API_KEY, apiKeyIndex: 3, accountIndex: 1, config: testnet, transport: opts.transport ?? t });
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
    const signer = await LighterSigner.open({ apiPrivateKey: API_KEY, apiKeyIndex: 3, accountIndex: 1, config: getLighterConfig("mainnet"), transport: fakeTransport().t });
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
      { marketId: 0, symbol: "ETH", size: "0.5", sign: -1, avgEntryPrice: "4000", unrealizedPnl: "-5", realizedPnl: "1.25", liquidationPrice: "4800" },
      { marketId: 1, symbol: "BTC", size: "0", sign: 1, avgEntryPrice: "0", unrealizedPnl: "0", realizedPnl: "3", liquidationPrice: null },
    ],
  });
  assert(view.positions.length === 1 && view.positions[0].unrealizedPnl === "-5" && view.positions[0].realizedPnl === "1.25", "PnL strings preserved; flat positions hidden");

  // ═══ 4. Real official WASM ════════════════════════════════════════════
  try {
    verifySignerArtifacts();
  } catch (e) {
    console.log(`[SKIP] official WASM not built (${(e as Error).message}) — run scripts/build-lighter-signer.sh`);
    return finish();
  }
  {
    // Throwaway, unregistered key generated by the official signer itself.
    const { Worker } = await import("node:worker_threads");
    const keyGen = new Worker(
      `const {parentPort}=require("node:worker_threads");require(process.cwd()+"/vendor/lighter-signer/wasm_exec.js");` +
        `const go=new Go();WebAssembly.instantiate(require("fs").readFileSync(process.cwd()+"/vendor/lighter-signer/lighter-signer.wasm"),go.importObject)` +
        `.then(({instance})=>{go.run(instance);parentPort.postMessage(GenerateAPIKey());});`,
      { eval: true },
    );
    const key = await new Promise<{ privateKey: string }>((r) => keyGen.once("message", r));
    await keyGen.terminate();

    const signer = await LighterSigner.open({ apiPrivateKey: key.privateKey, apiKeyIndex: 3, accountIndex: 47, config: testnet, timeoutMs: 10_000 });
    try {
      const order = await signer.createOrder(scaleOrderIntent(baseIntent, 12));
      assert(order.txType === LIGHTER_TX_TYPE.createOrder && order.txHash.length > 0, "real WASM: create order signed, fields cross-checked");
      const info = JSON.parse(order.txInfo) as Record<string, unknown>;
      assert(typeof info.Sig === "string" && (info.Sig as string).length > 0, "real WASM: signature present");
      assert(!order.txInfo.includes(key.privateKey), "real WASM: API private key absent from signed output");
      const cancel = await signer.cancelOrder({ marketIndex: 0, orderIndex: 123, nonce: 13 });
      assert(cancel.txType === LIGHTER_TX_TYPE.cancelOrder, "real WASM: cancel signed, fields cross-checked");
      const modify = await signer.modifyOrder({ marketIndex: 0, orderIndex: 123, baseAmount: 2000, price: 406000, nonce: 14 });
      assert(modify.txType === LIGHTER_TX_TYPE.modifyOrder, "real WASM: modify signed, fields cross-checked");
      const lev = await signer.updateLeverage({ marketIndex: 0, initialMarginFraction: 1000, marginMode: 0, nonce: 15 });
      assert(lev.txType === LIGHTER_TX_TYPE.updateLeverage, "real WASM: leverage signed, fields cross-checked");
      await rejects(
        () => signer.createOrder({ ...scaleOrderIntent(baseIntent, 16), marketIndex: 40000 }),
        (e) => e instanceof LighterSignerError && !(e as Error).message.includes(key.privateKey),
        "real WASM: out-of-range market refused; error does not leak key",
      );
    } finally {
      await signer.close();
    }
  }
  return finish();
}

function finish() {
  console.log(failures === 0 ? "\nAll Lighter execution tests passed." : `\n${failures} failure(s).`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
