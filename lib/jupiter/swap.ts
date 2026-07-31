// Server-only. Executes real swaps from an agent wallet.
import {
  assertIsTransactionWithBlockhashLifetime,
  assertIsTransactionWithinSizeLimit,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionLifetimeConstraintFromCompiledTransactionMessage,
  signTransaction,
} from "@solana/kit";

import { decryptSecret } from "@/lib/solana/agent-wallet";
import { sendAndConfirmOverHttp } from "@/lib/solana/confirm";

/**
 * Swap execution via Jupiter.
 *
 * Jupiter is a quote-and-build service, not a custodian: it returns an
 * unsigned transaction that only the agent wallet's own key can sign. The
 * funds never leave the operator's control in the process, which is the
 * whole reason execution goes here rather than through a venue that would
 * have to hold the wallet.
 */

export const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;

const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";
const HTTP_TIMEOUT_MS = 10_000;

export type SwapQuote = {
  inAmount: string;
  outAmount: string;
  /** Minimum out after slippage — what actually binds the fill. */
  otherAmountThreshold: string;
  priceImpactPct: string;
  raw: unknown;
};

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Price for a swap. `amount` is in the input token's smallest unit
 * (lamports for SOL) — Jupiter rejects human-readable amounts, and passing
 * one would silently quote a trade a billion times too small.
 */
export async function getSwapQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
}): Promise<SwapQuote | null> {
  const url = new URL(QUOTE_URL);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("slippageBps", String(params.slippageBps));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    if (typeof json.outAmount !== "string") return null;
    return {
      inAmount: String(json.inAmount),
      outAmount: String(json.outAmount),
      otherAmountThreshold: String(json.otherAmountThreshold ?? json.outAmount),
      priceImpactPct: String(json.priceImpactPct ?? "0"),
      raw: json,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Jupiter simulated the transaction while building it, and the simulation
 * failed. Distinct from an execution fault because it is a *refusal*, not a
 * crash: submitting anyway lands a transaction that reverts, and a reverted
 * transaction still pays its fee (§11.1) out of the reserve that exists so
 * an entry can always afford its own exit (§16.3).
 *
 * Verified before relying on it: `simulationError` comes back null for
 * viable swaps from funded wallets, and non-null for ones that cannot pay.
 * It is a real signal rather than a field that is always populated.
 */
export class SwapSimulationFailure extends Error {
  readonly simulationError: unknown;
  constructor(detail: string, simulationError: unknown) {
    super(detail);
    this.name = "SwapSimulationFailure";
    this.simulationError = simulationError;
  }
}

/** Jupiter reports `{ errorCode, error }`; neither field is guaranteed. */
function describeSimulationError(raw: unknown): string {
  if (raw && typeof raw === "object") {
    const { error, errorCode } = raw as { error?: unknown; errorCode?: unknown };
    const message = typeof error === "string" ? error : null;
    const code = typeof errorCode === "string" ? errorCode : null;
    if (message && code) return `${message} (${code})`;
    if (message) return message;
    if (code) return code;
  }
  return "simulation failed";
}

export type SwapResult = {
  signature: string;
  /** Smallest units actually quoted; the fill is bounded by the quote's
   * slippage threshold, not guaranteed equal to outAmount. */
  inAmount: string;
  outAmount: string;
};

/**
 * Signs and submits a swap from an agent wallet.
 *
 * Deliberately does NOT retry. A swap that was submitted but whose
 * confirmation we failed to observe may well have landed; sending it
 * again is how one signal becomes two positions and blows through the
 * operator's size limit (whitepaper §11.2). A caller that wants to try
 * again must first reconcile against the chain — so this throws and
 * leaves that decision upstream rather than quietly doing it here.
 */
export async function executeSwap(params: {
  agentSecretEnc: string;
  quote: SwapQuote;
  /** Agent's own RPC when it has one; falls back to the shared endpoint. */
  rpcUrl?: string | null;
}): Promise<SwapResult> {
  const signer = await createKeyPairSignerFromBytes(
    decryptSecret(params.agentSecretEnc)
  );

  const built = await postJson<{
    swapTransaction?: string;
    /** Jupiter's own deadline for the blockhash it built with. JSON number,
     * so it must be widened to bigint before any kit API sees it. */
    lastValidBlockHeight?: number;
    /** Null when the build simulated cleanly. */
    simulationError?: unknown;
  }>(SWAP_URL, {
    quoteResponse: params.quote.raw,
    userPublicKey: signer.address,
    // Wrapping is required to spend native SOL through an AMM, and
    // unwrapping returns the remainder rather than stranding it in a
    // temporary wrapped-SOL account.
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  });

  if (!built?.swapTransaction) {
    throw new Error("Jupiter did not return a transaction");
  }

  /* Refuse before signing. This is the same posture as skipping a candidate
     with no route (§11.1): a transaction already known to revert cannot
     produce a position, so submitting it only burns the fee. Deliberately
     not retried — §11.2. */
  if (built.simulationError != null) {
    throw new SwapSimulationFailure(
      describeSimulationError(built.simulationError),
      built.simulationError
    );
  }

  const unsigned = Uint8Array.from(Buffer.from(built.swapTransaction, "base64"));
  const transaction = getTransactionDecoder().decode(unsigned);
  const signed = await signTransaction([signer.keyPair], transaction);

  const endpoint =
    params.rpcUrl?.trim() ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com";
  /* One endpoint, HTTP only. Confirmation polls rather than subscribing, so
     whatever URL the operator saved for this bot is the only one needed —
     see lib/solana/confirm.ts for why guessing a websocket URL from it was
     the wrong shape for a field an operator just pastes in. */
  const rpc = createSolanaRpc(endpoint);

  /* The lifetime has to describe the transaction we are actually sending.
     A decoded transaction carries only `messageBytes` and `signatures`, so
     the constraint has to be read back out of the compiled message rather
     than invented: the blockhash below is the one Jupiter built with and
     the one the signature covers. Pasting a freshly fetched blockhash over
     it, as this did before, left the confirmation strategy watching the
     expiry of a blockhash the transaction never referenced. */
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(
    signed.messageBytes
  );
  const lifetime =
    await getTransactionLifetimeConstraintFromCompiledTransactionMessage(
      compiledMessage
    );
  if (!("blockhash" in lifetime)) {
    throw new Error("Jupiter returned a durable-nonce transaction, unsupported");
  }

  /* Deadline for that blockhash. Jupiter publishes it alongside the
     transaction, which is the authoritative value; the chain is only asked
     when it is missing. Both arrive as JSON numbers and must be widened,
     because the blockhash-lifetime predicate requires bigint and rejects a
     number silently — which surfaced as an undecipherable
     SOLANA_ERROR__TRANSACTION__EXPECTED_BLOCKHASH_LIFETIME (#5663002)
     rather than as anything an operator could act on. */
  let lastValidBlockHeight: bigint;
  if (
    typeof built.lastValidBlockHeight === "number" &&
    Number.isSafeInteger(built.lastValidBlockHeight)
  ) {
    lastValidBlockHeight = BigInt(built.lastValidBlockHeight);
  } else {
    const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
    if (typeof height !== "bigint") {
      throw new Error(
        `RPC returned no usable block height (got ${typeof height}); cannot bound this swap's lifetime`
      );
    }
    // A blockhash is accepted for roughly 150 further blocks. Written as a
    // constructor call rather than a 150n literal: this project targets
    // ES2017, where bigint literals are a compile error.
    lastValidBlockHeight = height + BigInt(150);
  }

  const signedWithLifetime = {
    ...signed,
    lifetimeConstraint: { blockhash: lifetime.blockhash, lastValidBlockHeight },
  };

  assertIsTransactionWithBlockhashLifetime(signedWithLifetime);
  assertIsTransactionWithinSizeLimit(signedWithLifetime);

  const signature = await sendAndConfirmOverHttp(rpc, signedWithLifetime);

  return {
    signature,
    inAmount: params.quote.inAmount,
    outAmount: params.quote.outAmount,
  };
}

/** SOL amount → lamports, for quoting a buy. */
export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}
