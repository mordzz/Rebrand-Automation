/**
 * Lighter semantic order execution - PR12.
 *
 *   Noah strategy/risk → PerpOrderIntent (this module validates + scales)
 *   → LighterSigner (official WASM) → POST /api/v1/sendTx → Lighter
 *
 * Semantics are taken from Lighter's official sources (lighter-go v1.0.10
 * constants, lighter-python examples), not ported from Drift:
 *   - side: `is_ask` 1 = sell/ask, 0 = buy/bid
 *   - order type: 0 limit, 1 market; TIF: 0 IOC, 1 good-till-time, 2 post-only
 *   - market orders are IOC with order_expiry 0; GTT uses the official
 *     default expiry (-1 → 28 days, applied inside the official signer)
 *   - size/price are integers in market decimals (precision.ts)
 *   - client_order_index ∈ [1, 2^48-1]; nonce is per (account, api key)
 *
 * State-changing submission is TESTNET ONLY. There is no mainnet path.
 */
import { LighterClient, type LighterMarket } from "@/lib/lighter/client";
import type { LighterConfig } from "@/lib/lighter/config";
import {
  leverageToInitialMarginFraction,
  MAX_ORDER_BASE_AMOUNT,
  MAX_ORDER_PRICE,
  MIN_ORDER_PRICE,
  scaleDecimal,
} from "@/lib/lighter/precision";
import type { LighterSigner, ScaledCreateOrder, SignedLighterTx } from "@/lib/lighter/signer-adapter";

export const MAX_CLIENT_ORDER_INDEX = (BigInt(1) << BigInt(48)) - BigInt(1);

export type PerpOrderIntent = {
  market: LighterMarket;
  side: "buy" | "sell";
  type: "limit" | "market";
  /** Base size, decimal string (e.g. "0.1"). */
  size: string;
  /** Limit price, or the worst acceptable price for a market order. */
  price: string;
  reduceOnly: boolean;
  timeInForce: "gtt" | "ioc" | "post_only";
  clientOrderIndex: number;
};

export class LighterOrderError extends Error {
  constructor(readonly kind: "invalid_intent" | "replay" | "api_error" | "network" | "mainnet_refused", message: string) {
    super(message);
    this.name = "LighterOrderError";
  }
}

const invalid = (m: string): never => {
  throw new LighterOrderError("invalid_intent", m);
};

/** Pure: validates an intent against market metadata and scales it. */
export function scaleOrderIntent(intent: PerpOrderIntent, nonce: number): ScaledCreateOrder {
  const { market } = intent;
  if (!Number.isInteger(market.marketId) || market.marketId < 0 || market.marketId > 32767) invalid(`invalid market id ${market.marketId}`);
  if (market.status !== "active") invalid(`market ${market.symbol} is not active`);
  if (intent.side !== "buy" && intent.side !== "sell") invalid(`invalid side ${String(intent.side)}`);

  if (intent.type === "market" && intent.timeInForce !== "ioc") invalid("market orders must be IOC");
  if (intent.timeInForce === "post_only" && intent.type !== "limit") invalid("post-only requires a limit order");
  const tif = ({ ioc: 0, gtt: 1, post_only: 2 } as const)[intent.timeInForce];
  if (tif === undefined) invalid(`invalid time-in-force ${String(intent.timeInForce)}`);
  const orderType = ({ limit: 0, market: 1 } as const)[intent.type];
  if (orderType === undefined) invalid(`invalid order type ${String(intent.type)}`);

  const coi = BigInt(intent.clientOrderIndex);
  if (!Number.isSafeInteger(intent.clientOrderIndex) || coi < BigInt(1) || coi > MAX_CLIENT_ORDER_INDEX) {
    invalid("clientOrderIndex must be an integer in [1, 2^48-1]");
  }
  if (!Number.isSafeInteger(nonce) || nonce < 0) invalid("nonce must be a non-negative integer");

  let base: bigint;
  let price: bigint;
  let minBase: bigint;
  try {
    base = scaleDecimal(intent.size, market.sizeDecimals, "size");
    price = scaleDecimal(intent.price, market.priceDecimals, "price");
    minBase = scaleDecimal(market.minBaseAmount, market.sizeDecimals, "minBaseAmount");
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error));
  }
  if (base <= BigInt(0) || base < minBase) invalid(`size ${intent.size} is below the market minimum ${market.minBaseAmount}`);
  if (base > MAX_ORDER_BASE_AMOUNT) invalid("size exceeds Lighter's maximum base amount");
  if (price < MIN_ORDER_PRICE || price > MAX_ORDER_PRICE) invalid("price is outside Lighter's allowed range");

  return {
    marketIndex: market.marketId,
    clientOrderIndex: intent.clientOrderIndex,
    baseAmount: Number(base),
    price: Number(price),
    isAsk: intent.side === "sell" ? 1 : 0,
    orderType,
    timeInForce: tif,
    reduceOnly: intent.reduceOnly ? 1 : 0,
    orderExpiry: tif === 0 ? 0 : -1,
    nonce,
  };
}

export type SendTx = (config: LighterConfig, signed: SignedLighterTx) => Promise<{ txHash: string }>;

/** Documented POST /api/v1/sendTx (form-encoded tx_type + tx_info). */
export const httpSendTx: SendTx = async (config, signed) => {
  const body = new URLSearchParams({ tx_type: String(signed.txType), tx_info: signed.txInfo });
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}/sendTx`, { method: "POST", body, cache: "no-store" });
  } catch (error) {
    throw new LighterOrderError("network", `sendTx failed: ${error instanceof Error ? error.message : error}`);
  }
  const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string; tx_hash?: string };
  if (!res.ok || json.code !== 200) {
    throw new LighterOrderError("api_error", `Lighter rejected tx: ${json.message ?? `HTTP ${res.status}`}`);
  }
  return { txHash: json.tx_hash ?? signed.txHash };
};

export type NextNonce = (config: LighterConfig, accountIndex: number, apiKeyIndex: number) => Promise<number>;

/** Documented GET /api/v1/nextNonce. */
export const httpNextNonce: NextNonce = async (config, accountIndex, apiKeyIndex) => {
  const res = await fetch(`${config.apiBaseUrl}/nextNonce?account_index=${accountIndex}&api_key_index=${apiKeyIndex}`, { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { code?: number; nonce?: number; message?: string };
  if (!res.ok || json.code !== 200 || !Number.isSafeInteger(json.nonce)) {
    throw new LighterOrderError("api_error", `nextNonce failed: ${json.message ?? `HTTP ${res.status}`}`);
  }
  return json.nonce as number;
};

/**
 * Executes semantic perps actions for one Lighter account + API key.
 * Tracks nonces locally (refetching after any failure) and refuses to
 * reuse a client order index within the process.
 */
export class LighterExecutor {
  private nonce: number | null = null;
  private readonly usedClientOrderIndexes = new Set<number>();
  private networkChecked = false;

  constructor(
    private readonly signer: LighterSigner,
    private readonly deps: { sendTx?: SendTx; nextNonce?: NextNonce; client?: LighterClient } = {},
  ) {
    if (signer.config.network !== "testnet") {
      throw new LighterOrderError("mainnet_refused", "Lighter order execution is enabled on the Robinhood testnet environment only");
    }
  }

  private async takeNonce(): Promise<number> {
    if (!this.networkChecked) {
      await (this.deps.client ?? new LighterClient(this.signer.config)).assertNetwork();
      this.networkChecked = true;
    }
    if (this.nonce === null) {
      this.nonce = await (this.deps.nextNonce ?? httpNextNonce)(this.signer.config, this.signer.accountIndex, this.signer.apiKeyIndex);
    }
    return this.nonce;
  }

  private async submit(sign: (nonce: number) => Promise<SignedLighterTx>): Promise<{ txHash: string; nonce: number }> {
    const nonce = await this.takeNonce();
    try {
      const signed = await sign(nonce);
      const { txHash } = await (this.deps.sendTx ?? httpSendTx)(this.signer.config, signed);
      this.nonce = nonce + 1;
      return { txHash, nonce };
    } catch (error) {
      this.nonce = null; // resync from Lighter before the next attempt
      throw error;
    }
  }

  async createOrder(intent: PerpOrderIntent) {
    if (this.usedClientOrderIndexes.has(intent.clientOrderIndex)) {
      throw new LighterOrderError("replay", `clientOrderIndex ${intent.clientOrderIndex} was already submitted`);
    }
    scaleOrderIntent(intent, 0); // validate before touching nonce/network
    this.usedClientOrderIndexes.add(intent.clientOrderIndex);
    return this.submit((nonce) => this.signer.createOrder(scaleOrderIntent(intent, nonce)));
  }

  async cancelOrder(marketIndex: number, orderIndex: number) {
    if (!Number.isSafeInteger(orderIndex) || orderIndex < 0) invalid("orderIndex must be a non-negative integer");
    return this.submit((nonce) => this.signer.cancelOrder({ marketIndex, orderIndex, nonce }));
  }

  async modifyOrder(market: LighterMarket, orderIndex: number, size: string, price: string) {
    const baseAmount = Number(scaleDecimal(size, market.sizeDecimals, "size"));
    const scaledPrice = Number(scaleDecimal(price, market.priceDecimals, "price"));
    return this.submit((nonce) => this.signer.modifyOrder({ marketIndex: market.marketId, orderIndex, baseAmount, price: scaledPrice, nonce }));
  }

  async updateLeverage(market: LighterMarket, leverage: number, marginMode: "cross" | "isolated") {
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > market.maxLeverage) {
      invalid(`leverage must be an integer in 1..${market.maxLeverage} for ${market.symbol}`);
    }
    const initialMarginFraction = leverageToInitialMarginFraction(leverage);
    return this.submit((nonce) =>
      this.signer.updateLeverage({ marketIndex: market.marketId, initialMarginFraction, marginMode: marginMode === "isolated" ? 1 : 0, nonce }),
    );
  }
}
