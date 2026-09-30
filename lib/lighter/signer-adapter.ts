/**
 * Strict TypeScript adapter to Lighter's OFFICIAL signer — PR12.
 *
 * Lighter L2 transactions are not EVM transactions and are never signed
 * with viem. They are signed by the official lighter-go implementation,
 * compiled to WASM from a pinned upstream tag (see
 * LIGHTER_SIGNER_PROVENANCE and scripts/build-lighter-signer.sh) and run in
 * an isolated worker_thread (signer-worker.cjs).
 *
 * This adapter:
 *   - verifies the artifacts' SHA-256 against the pinned values before
 *     loading them (a tampered/unknown binary is never executed)
 *   - binds the Lighter L2 signing chain id to PR11's network config and
 *     refuses anything else (never a Robinhood EVM chain id)
 *   - exposes semantic operations only — createOrder / cancelOrder /
 *     modifyOrder / updateLeverage / createAuthToken — never "sign bytes"
 *   - validates the signer's output (tx type + echoed fields) before it can
 *     be submitted, and enforces a per-call timeout
 *   - never handles the RAW Lighter API private key at all: it is generated,
 *     encrypted (LIGHTER_API_KEY_ENCRYPTION_KEY) and decrypted only inside
 *     the worker; this thread sees only the public key + encrypted blob
 *
 * It does NOT decide whether to trade: Noah strategy/risk produce the
 * intent; orders.ts validates and scales it; this module only signs.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { getLighterConfig, type LighterConfig } from "@/lib/lighter/config";

export const LIGHTER_SIGNER_PROVENANCE = {
  repository: "https://github.com/elliottech/lighter-go",
  tag: "v1.0.10",
  commit: "9d38261d1a4cc5c7211b383ba07a4d6e41604708",
  goToolchain: "golang:1.23.2-bullseye",
  build: "GOOS=js GOARCH=wasm go build -trimpath -o lighter-signer.wasm ./wasm/",
  wasmSha256: "85cdfcf2ae52315aee75a1c90fa81d986cfdd362e1e137ba16a1759eb804f8ba",
  wasmExecSha256: "45ce9dfe7211247544ab6f4268eb8cb5b6f3d5ae602dc3b51447b7eada99c229",
} as const;

/** Official tx type ids (lighter-go types/txtypes/constants.go @ v1.0.10). */
export const LIGHTER_TX_TYPE = { changePubKey: 8, createOrder: 14, cancelOrder: 15, modifyOrder: 17, updateLeverage: 20 } as const;

export class LighterSignerError extends Error {
  constructor(
    readonly kind: "unavailable" | "artifact_mismatch" | "timeout" | "signer_error" | "malformed_output" | "wrong_domain",
    message: string,
  ) {
    super(message);
    this.name = "LighterSignerError";
  }
}

export type SignedLighterTx = { txType: number; txInfo: string; txHash: string; nonce: number };

/** Integer-level order fields, already validated/scaled by orders.ts. */
export type ScaledCreateOrder = {
  marketIndex: number;
  clientOrderIndex: number;
  baseAmount: number;
  price: number;
  isAsk: 0 | 1;
  orderType: 0 | 1;
  timeInForce: 0 | 1 | 2;
  reduceOnly: 0 | 1;
  orderExpiry: number;
  nonce: number;
};

/** Transport to the signer worker — injectable for deterministic tests. */
export type SignerTransport = {
  call(op: string, payload: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>>;
  close(): Promise<void>;
};

const DEFAULT_ARTIFACT_DIR = join(process.cwd(), "vendor", "lighter-signer");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifySignerArtifacts(dir: string = DEFAULT_ARTIFACT_DIR): void {
  let wasm: string;
  let exec: string;
  try {
    wasm = sha256(join(dir, "lighter-signer.wasm"));
    exec = sha256(join(dir, "wasm_exec.js"));
  } catch {
    throw new LighterSignerError("unavailable", `Lighter signer artifacts missing in ${dir} — run scripts/build-lighter-signer.sh`);
  }
  if (wasm !== LIGHTER_SIGNER_PROVENANCE.wasmSha256 || exec !== LIGHTER_SIGNER_PROVENANCE.wasmExecSha256) {
    throw new LighterSignerError("artifact_mismatch", "Lighter signer artifact checksum does not match the pinned official build");
  }
}

function workerTransport(): SignerTransport {
  const worker = new Worker(join(process.cwd(), "lib", "lighter", "signer-worker.cjs"));
  worker.unref();
  let seq = 0;
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  worker.on("message", (m: { id: number; ok: boolean; result?: Record<string, unknown>; error?: string }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result ?? {});
    else p.reject(new LighterSignerError("signer_error", m.error ?? "signer error"));
  });
  worker.on("error", (e) => {
    for (const p of pending.values()) p.reject(new LighterSignerError("unavailable", `signer worker crashed: ${e.message}`));
    pending.clear();
  });
  return {
    call(op, payload, timeoutMs) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new LighterSignerError("timeout", `Lighter signer "${op}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (v) => (clearTimeout(timer), resolve(v)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        });
        worker.postMessage({ id, op, ...payload });
      });
    },
    async close() {
      await worker.terminate();
    },
  };
}

type SignerTarget = {
  apiKeyIndex: number;
  accountIndex: number;
  config?: LighterConfig;
  timeoutMs?: number;
  artifactDir?: string;
  transport?: SignerTransport;
};

export type OpenSignerOptions = SignerTarget & {
  /** Encrypted blob produced by provision(); decrypted only in the worker. */
  apiKeyEnc: string;
};

/** Output of the official SignChangePubKey, unsigned by L1 yet. */
export type PreparedChangePubKey = { txType: number; txInfo: string; txHash: string; messageToSign: string; nonce: number };

/** Allowed L2 signing domains: exactly PR11's per-network ids. */
const EXPECTED_DOMAIN: Record<LighterConfig["network"], number> = { testnet: 300, mainnet: 466324 };

export class LighterSigner {
  private constructor(
    private readonly transport: SignerTransport,
    readonly config: LighterConfig,
    readonly apiKeyIndex: number,
    readonly accountIndex: number,
    private readonly timeoutMs: number,
  ) {}

  private static async start(
    opts: SignerTarget,
    op: "init" | "provision",
    extra: Record<string, unknown>,
  ): Promise<{ signer: LighterSigner; result: Record<string, unknown> }> {
    const config = opts.config ?? getLighterConfig();
    if (config.lighterChainId !== EXPECTED_DOMAIN[config.network]) {
      throw new LighterSignerError("wrong_domain", `Lighter signing chain id ${config.lighterChainId} is not the ${config.network} domain`);
    }
    if (!Number.isInteger(opts.apiKeyIndex) || opts.apiKeyIndex < 2 || opts.apiKeyIndex > 254) {
      throw new LighterSignerError("signer_error", "apiKeyIndex must be an integer in 2..254 (0-1 are reserved)");
    }
    if (!Number.isSafeInteger(opts.accountIndex) || opts.accountIndex < 0) {
      throw new LighterSignerError("signer_error", "accountIndex must be a non-negative integer");
    }
    const artifactDir = opts.artifactDir ?? DEFAULT_ARTIFACT_DIR;
    const transport = opts.transport ?? (verifySignerArtifacts(artifactDir), workerTransport());
    const timeoutMs = opts.timeoutMs ?? 5_000;
    let result: Record<string, unknown>;
    try {
      result = await transport.call(
        op,
        {
          ...extra,
          artifactDir,
          expectedWasmSha256: LIGHTER_SIGNER_PROVENANCE.wasmSha256,
          expectedWasmExecSha256: LIGHTER_SIGNER_PROVENANCE.wasmExecSha256,
          url: config.apiOrigin,
          network: config.network,
          lighterChainId: config.lighterChainId,
          apiKeyIndex: opts.apiKeyIndex,
          accountIndex: opts.accountIndex,
        },
        Math.max(timeoutMs, 30_000),
      );
    } catch (error) {
      await transport.close();
      throw error;
    }
    return { signer: new LighterSigner(transport, config, opts.apiKeyIndex, opts.accountIndex, timeoutMs), result };
  }

  /** Loads an existing (encrypted) API key into a fresh worker. */
  static async open(opts: OpenSignerOptions): Promise<LighterSigner> {
    if (typeof opts.apiKeyEnc !== "string" || !opts.apiKeyEnc.startsWith("lk1.")) {
      throw new LighterSignerError("signer_error", "encrypted Lighter API key blob is missing or malformed");
    }
    return (await LighterSigner.start(opts, "init", { apiKeyEnc: opts.apiKeyEnc })).signer;
  }

  /** Generates a NEW API key inside the worker with the official
   * GenerateAPIKey. Returns only the public key and the encrypted blob. */
  static async provision(opts: SignerTarget): Promise<{ signer: LighterSigner; publicKey: string; apiKeyEnc: string }> {
    const { signer, result } = await LighterSigner.start(opts, "provision", {});
    const { publicKey, apiKeyEnc } = result;
    if (typeof publicKey !== "string" || !/^(0x)?[0-9a-f]{80}$/i.test(publicKey) || typeof apiKeyEnc !== "string" || !apiKeyEnc.startsWith("lk1.")) {
      await signer.close();
      throw new LighterSignerError("malformed_output", "signer returned an unexpected provision result");
    }
    return { signer, publicKey, apiKeyEnc };
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  private async sign(
    op: Exclude<keyof typeof LIGHTER_TX_TYPE, "changePubKey">,
    args: number[],
    nonce: number,
    expect: Record<string, number>,
  ): Promise<SignedLighterTx> {
    const out = await this.transport.call(op, { args }, this.timeoutMs);
    if (typeof out.error === "string") throw new LighterSignerError("signer_error", out.error);
    const { txType, txInfo, txHash } = out;
    if (txType !== LIGHTER_TX_TYPE[op] || typeof txInfo !== "string" || typeof txHash !== "string" || !/^(0x)?[0-9a-f]+$/i.test(txHash)) {
      throw new LighterSignerError("malformed_output", `signer returned an unexpected ${op} result`);
    }
    let info: Record<string, unknown>;
    try {
      info = JSON.parse(txInfo) as Record<string, unknown>;
    } catch {
      throw new LighterSignerError("malformed_output", "signer txInfo is not JSON");
    }
    const mustMatch = { AccountIndex: this.accountIndex, ApiKeyIndex: this.apiKeyIndex, Nonce: nonce, ...expect };
    for (const [k, v] of Object.entries(mustMatch)) {
      if (info[k] !== v) throw new LighterSignerError("malformed_output", `signed ${op} field ${k} does not match the intent`);
    }
    return { txType: txType as number, txInfo, txHash, nonce };
  }

  createOrder(o: ScaledCreateOrder): Promise<SignedLighterTx> {
    // Arg order per official wasm/main.go SignCreateOrder (19 args). No
    // integrator fee, default self-trade modes, no skip-nonce.
    return this.sign(
      "createOrder",
      [o.marketIndex, o.clientOrderIndex, o.baseAmount, o.price, o.isAsk, o.orderType, o.timeInForce, o.reduceOnly, 0, o.orderExpiry, 0, 0, 0, 0, 0, 0, o.nonce, this.apiKeyIndex, this.accountIndex],
      o.nonce,
      {
        MarketIndex: o.marketIndex, ClientOrderIndex: o.clientOrderIndex, BaseAmount: o.baseAmount, Price: o.price,
        IsAsk: o.isAsk, Type: o.orderType, TimeInForce: o.timeInForce, ReduceOnly: o.reduceOnly,
      },
    );
  }

  /** Official CreateAuthToken (max 8h per Lighter docs). */
  async createAuthToken(deadlineUnixSeconds: number): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(deadlineUnixSeconds) || deadlineUnixSeconds <= now || deadlineUnixSeconds > now + 8 * 3600) {
      throw new LighterSignerError("signer_error", "auth token deadline must be in the future and at most 8 hours away");
    }
    const out = await this.transport.call("createAuthToken", { args: [deadlineUnixSeconds, this.apiKeyIndex, this.accountIndex] }, this.timeoutMs);
    if (typeof out.error === "string") throw new LighterSignerError("signer_error", out.error);
    if (typeof out.authToken !== "string" || out.authToken.length < 10) {
      throw new LighterSignerError("malformed_output", "signer returned an unexpected auth token");
    }
    return out.authToken;
  }

  /** Official SignChangePubKey for THIS worker's key. Returns the tx plus
   * the official L1 `messageToSign`; registration.ts independently verifies
   * both before the agent wallet signs anything. */
  async prepareChangePubKey(pubKeyHex: string, nonce: number): Promise<PreparedChangePubKey> {
    const out = await this.transport.call("prepareChangePubKey", { args: [pubKeyHex, 0, nonce, this.apiKeyIndex, this.accountIndex] }, this.timeoutMs);
    if (typeof out.error === "string") throw new LighterSignerError("signer_error", out.error);
    const { txType, txInfo, txHash, messageToSign } = out;
    if (txType !== LIGHTER_TX_TYPE.changePubKey || typeof txInfo !== "string" || typeof txHash !== "string" || typeof messageToSign !== "string") {
      throw new LighterSignerError("malformed_output", "signer returned an unexpected change-pubkey result");
    }
    return { txType, txInfo, txHash, messageToSign, nonce };
  }

  cancelOrder(c: { marketIndex: number; orderIndex: number; nonce: number }): Promise<SignedLighterTx> {
    return this.sign("cancelOrder", [c.marketIndex, c.orderIndex, 0, c.nonce, this.apiKeyIndex, this.accountIndex], c.nonce, {
      MarketIndex: c.marketIndex, Index: c.orderIndex,
    });
  }

  modifyOrder(m: { marketIndex: number; orderIndex: number; baseAmount: number; price: number; nonce: number }): Promise<SignedLighterTx> {
    return this.sign(
      "modifyOrder",
      [m.marketIndex, m.orderIndex, m.baseAmount, m.price, 0, 0, 0, 0, 0, 0, 0, m.nonce, 0 /* NilOrderVersion */, this.apiKeyIndex, this.accountIndex],
      m.nonce,
      { MarketIndex: m.marketIndex, Index: m.orderIndex, BaseAmount: m.baseAmount, Price: m.price },
    );
  }

  updateLeverage(l: { marketIndex: number; initialMarginFraction: number; marginMode: 0 | 1; nonce: number }): Promise<SignedLighterTx> {
    return this.sign("updateLeverage", [l.marketIndex, l.initialMarginFraction, l.marginMode, 0, l.nonce, this.apiKeyIndex, this.accountIndex], l.nonce, {
      MarketIndex: l.marketIndex, InitialMarginFraction: l.initialMarginFraction, MarginMode: l.marginMode,
    });
  }
}
