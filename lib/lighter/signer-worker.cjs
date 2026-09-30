// Lighter official signer worker — PR12.
//
// Runs the OFFICIAL lighter-go WASM signer (see vendor/lighter-signer and
// scripts/build-lighter-signer.sh for provenance) inside an isolated
// worker_thread. The RAW Lighter API private key exists ONLY in this
// worker:
//   - "provision" generates it with the official GenerateAPIKey, encrypts
//     it here, and returns only { publicKey, apiKeyEnc }
//   - "init" receives only the encrypted blob and decrypts it here
// The encryption key (LIGHTER_API_KEY_ENCRYPTION_KEY) is read from this
// worker's own environment — the main thread never handles it either.
// Blobs are AES-256-GCM with AAD bound to network/account/api-key index,
// so a blob cannot be replayed onto a different account or key slot.
//
// There is NO generic "call any export" / "sign bytes" operation: only the
// fixed semantic operations in OPS map to fixed WASM functions. Nothing
// that contains the private key is ever posted back.
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS worker loaded by worker_threads, not bundled */
"use strict";

const { parentPort } = require("node:worker_threads");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const OPS = {
  createOrder: "SignCreateOrder",
  cancelOrder: "SignCancelOrder",
  modifyOrder: "SignModifyOrder",
  updateLeverage: "SignUpdateLeverage",
  createAuthToken: "CreateAuthToken",
  prepareChangePubKey: "SignChangePubKey",
};

const ENC_VERSION = "lk1";
let secret = null;
let ready = false;

function encryptionKey() {
  const raw = (process.env.LIGHTER_API_KEY_ENCRYPTION_KEY || "").trim();
  if (!raw) throw new Error("LIGHTER_API_KEY_ENCRYPTION_KEY is not set");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("LIGHTER_API_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

function aad(msg) {
  return Buffer.from(`lighter-api-key:v1:${msg.network}:${msg.accountIndex}:${msg.apiKeyIndex}`);
}

function encrypt(plain, msg) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  c.setAAD(aad(msg));
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [ENC_VERSION, iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

function decrypt(blob, msg) {
  const [v, iv, tag, data] = String(blob).split(".");
  if (v !== ENC_VERSION || !iv || !tag || !data) throw new Error("encrypted Lighter API key is not in the expected format");
  const d = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  d.setAAD(aad(msg));
  d.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new Error("encrypted Lighter API key failed to decrypt (wrong key or bound to a different account/key index)");
  }
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Loads the pinned official artifacts, re-verifying their SHA-256 here —
// on the exact bytes about to be executed — rather than trusting the main
// thread's earlier check. wasm_exec.js is evaluated from its verified bytes
// (no dynamic require, which also keeps bundlers from tracing it).
async function loadWasm(msg) {
  const execSrc = fs.readFileSync(path.join(msg.artifactDir, "wasm_exec.js"));
  const bytes = fs.readFileSync(path.join(msg.artifactDir, "lighter-signer.wasm"));
  if (sha256(execSrc) !== msg.expectedWasmExecSha256 || sha256(bytes) !== msg.expectedWasmSha256) {
    throw new Error("Lighter signer artifact checksum does not match the pinned official build");
  }
  vm.runInThisContext(execSrc.toString("utf8"), { filename: "wasm_exec.js" });
  const go = new globalThis.Go();
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance);
}

function createClient(msg, privateKey) {
  const res = globalThis.CreateClient(msg.url, privateKey, msg.lighterChainId, msg.apiKeyIndex, msg.accountIndex);
  if (res && res.error) throw new Error(`CreateClient failed: ${res.error}`);
}

async function init(msg) {
  if (ready) throw new Error("signer already initialized");
  encryptionKey(); // fail fast before loading anything
  await loadWasm(msg);
  secret = decrypt(msg.apiKeyEnc, msg);
  createClient(msg, secret);
  ready = true;
  return {};
}

async function provision(msg) {
  if (ready) throw new Error("signer already initialized");
  encryptionKey();
  await loadWasm(msg);
  const k = globalThis.GenerateAPIKey();
  if (!k || k.error || typeof k.privateKey !== "string" || typeof k.publicKey !== "string") {
    throw new Error(`GenerateAPIKey failed${k && k.error ? `: ${k.error}` : ""}`);
  }
  secret = k.privateKey;
  createClient(msg, secret);
  ready = true;
  return { publicKey: k.publicKey, apiKeyEnc: encrypt(secret, msg) };
}

function scrub(value) {
  if (!secret) return value;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "string" && v.includes(secret) ? "[redacted]" : v)));
}

parentPort.on("message", async (msg) => {
  try {
    let result;
    if (msg.op === "init") result = await init(msg);
    else if (msg.op === "provision") result = await provision(msg);
    else if (Object.prototype.hasOwnProperty.call(OPS, msg.op)) {
      if (!ready) throw new Error("signer not initialized");
      result = { ...globalThis[OPS[msg.op]](...msg.args) };
    } else throw new Error("unsupported signer operation");
    parentPort.postMessage({ id: msg.id, ok: true, result: scrub(result) });
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    parentPort.postMessage({ id: msg.id, ok: false, error: secret ? message.split(secret).join("[redacted]") : message });
  }
});
