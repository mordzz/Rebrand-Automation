// Lighter official signer worker — PR12.
//
// Runs the OFFICIAL lighter-go WASM signer (see vendor/lighter-signer and
// scripts/build-lighter-signer.sh for provenance) inside an isolated
// worker_thread, so the Go globals it installs and the Lighter API private
// key it holds never exist in the main Next.js/daemon thread.
//
// Protocol (from signer-adapter.ts only):
//   { id, op: "init", artifactDir, url, apiPrivateKey, lighterChainId, apiKeyIndex, accountIndex }
//   { id, op: <one of OPS>, args: [...] }
// There is NO generic "call any export" or "sign bytes" operation: only the
// fixed semantic operations below map to fixed WASM functions. The private
// key is never echoed back, and any string containing it is redacted.
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS worker loaded by worker_threads, not bundled */
"use strict";

const { parentPort } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");

const OPS = {
  createOrder: "SignCreateOrder",
  cancelOrder: "SignCancelOrder",
  modifyOrder: "SignModifyOrder",
  updateLeverage: "SignUpdateLeverage",
  createAuthToken: "CreateAuthToken",
};

let secret = null;
let ready = false;

function redact(value) {
  if (!secret) return value;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "string" && v.includes(secret) ? "[redacted]" : v)));
}

async function init(msg) {
  if (ready) throw new Error("signer already initialized");
  require(path.join(msg.artifactDir, "wasm_exec.js"));
  const go = new globalThis.Go();
  const bytes = fs.readFileSync(path.join(msg.artifactDir, "lighter-signer.wasm"));
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance);
  secret = msg.apiPrivateKey;
  const res = globalThis.CreateClient(msg.url, msg.apiPrivateKey, msg.lighterChainId, msg.apiKeyIndex, msg.accountIndex);
  if (res && res.error) throw new Error(`CreateClient failed: ${res.error}`);
  ready = true;
  return {};
}

parentPort.on("message", async (msg) => {
  try {
    let result;
    if (msg.op === "init") {
      result = await init(msg);
    } else if (Object.prototype.hasOwnProperty.call(OPS, msg.op)) {
      if (!ready) throw new Error("signer not initialized");
      const out = globalThis[OPS[msg.op]](...msg.args);
      result = { ...out };
    } else {
      throw new Error(`unsupported signer operation`);
    }
    parentPort.postMessage({ id: msg.id, ok: true, result: redact(result) });
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    parentPort.postMessage({ id: msg.id, ok: false, error: secret ? message.split(secret).join("[redacted]") : message });
  }
});
