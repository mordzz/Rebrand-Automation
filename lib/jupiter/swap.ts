// Server-only. Executes real swaps from an agent wallet.
import {
  assertIsTransactionWithBlockhashLifetime,
  assertIsTransactionWithinSizeLimit,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getSignatureFromTransaction,
  getTransactionDecoder,
  sendAndConfirmTransactionFactory,
  signTransaction,
} from "@solana/kit";

import { decryptSecret } from "@/lib/solana/agent-wallet";

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

  const built = await postJson<{ swapTransaction?: string }>(SWAP_URL, {
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

  const unsigned = Uint8Array.from(Buffer.from(built.swapTransaction, "base64"));
  const transaction = getTransactionDecoder().decode(unsigned);
  const signed = await signTransaction([signer.keyPair], transaction);
  assertIsTransactionWithBlockhashLifetime(signed);
  assertIsTransactionWithinSizeLimit(signed);

  const endpoint =
    params.rpcUrl?.trim() ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com";
  const rpc = createSolanaRpc(endpoint);
  const rpcSubscriptions = createSolanaRpcSubscriptions(
    endpoint.replace(/^http/, "ws")
  );

  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, {
    commitment: "confirmed",
  });

  return {
    signature: getSignatureFromTransaction(signed),
    inAmount: params.quote.inAmount,
    outAmount: params.quote.outAmount,
  };
}

/** SOL amount → lamports, for quoting a buy. */
export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}
