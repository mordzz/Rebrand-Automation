/**
 * Read-only Lighter REST client — PR11 foundation.
 *
 * Only unauthenticated, documented, live-verified read endpoints:
 *   GET /api/v1/orderBookDetails            — market metadata + mark price
 *   GET /api/v1/accountsByL1Address         — account indexes for an EVM address
 *   GET /api/v1/account?by=index&value=N    — balances, collateral, positions
 *   GET /info                               — rollup contract (network check)
 *
 * No order placement, no API-key signing (that is PR12). Every numeric
 * field Lighter returns as a decimal string stays a string here — it is
 * never coerced through floating point on the money path.
 *
 * Collateral: the margin asset is whatever Lighter marks
 * `margin_mode: "enabled"` on the account — read, never assumed. (Docs and
 * ecosystem sources say USDG on mainnet; the live testnet reports USDC.)
 */
import { getAddress, isAddress } from "viem";

import { getLighterConfig, type LighterConfig } from "@/lib/lighter/config";

export class LighterApiError extends Error {
  constructor(
    public readonly kind: "unavailable" | "bad_response" | "not_found" | "wrong_network",
    message: string,
  ) {
    super(message);
    this.name = "LighterApiError";
  }
}

export type LighterMarket = {
  marketId: number;
  symbol: string;
  status: string;
  sizeDecimals: number;
  priceDecimals: number;
  minBaseAmount: string;
  minQuoteAmount: string;
  /** Max leverage = 10000 / min_initial_margin_fraction. */
  maxLeverage: number;
  maintenanceMarginFraction: number;
  markPrice: string;
  indexPrice: string;
  dailyPriceChangePct: number | null;
  openInterest: string;
};

export type LighterSubAccount = { accountIndex: number; l1Address: string; collateral: string; accountType: number };

/** GET /api/v1/apikeys entry (official ApiKey model). */
export type LighterApiKeyRecord = { accountIndex: number; apiKeyIndex: number; nonce: number; publicKey: string };

/** Official Order model (subset used by Noah). Amounts stay strings. */
export type LighterOrder = {
  orderIndex: number;
  clientOrderIndex: number;
  marketIndex: number;
  isAsk: boolean;
  type: string;
  timeInForce: string;
  reduceOnly: boolean;
  price: string;
  initialBaseAmount: string;
  remainingBaseAmount: string;
  filledBaseAmount: string;
  status: string;
};

/** GET /api/v1/fundings entry (official Funding model). */
export type LighterFundingRate = { timestamp: number; value: string; rate: string; direction: string };

/** GET /api/v1/positionFunding entry (official PositionFunding model). */
export type LighterPositionFunding = {
  timestamp: number; marketId: number; change: string; rate: string; positionSize: string; positionSide: string;
};

export type LighterPosition = {
  marketId: number;
  symbol: string;
  /** Position size as Lighter reports it (`position`), unmodified. */
  size: string;
  /** Lighter's raw `sign` field. Its semantics are not defined in the
   * first-party docs, so it is passed through, never interpreted as
   * long/short here — PR12 must confirm before deriving a side. */
  sign: number;
  avgEntryPrice: string;
  unrealizedPnl: string;
  realizedPnl: string;
  liquidationPrice: string | null;
  /** Cumulative funding paid out on this position (official field). */
  totalFundingPaidOut: string;
  allocatedMargin: string;
  marginMode: number;
};

export type LighterAccountState = {
  accountIndex: number;
  l1Address: string;
  collateral: string;
  availableBalance: string;
  totalAssetValue: string;
  /** The account's margin-enabled asset(s), as reported by Lighter. */
  collateralAssets: Array<{ symbol: string; marginBalance: string }>;
  positions: LighterPosition[];
};

type Fetcher = (url: string, headers?: Record<string, string>) => Promise<Response>;

const str = (v: unknown) => (v === null || v === undefined ? "0" : String(v));

async function getJson(url: string, fetcher: Fetcher, headers?: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetcher(url, headers);
  } catch (error) {
    throw new LighterApiError("unavailable", `Lighter request failed: ${error instanceof Error ? error.message : error}`);
  }
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new LighterApiError("bad_response", `Lighter returned non-JSON (HTTP ${res.status})`);
  }
  if (!res.ok || (typeof body.code === "number" && body.code !== 200)) {
    const msg = typeof body.message === "string" ? body.message : `HTTP ${res.status}`;
    throw new LighterApiError(/not found/i.test(msg) ? "not_found" : "unavailable", `Lighter: ${msg}`);
  }
  return body;
}

export function parseMarket(raw: Record<string, unknown>): LighterMarket | null {
  const marketId = Number(raw.market_id);
  const imf = Number(raw.min_initial_margin_fraction);
  if (!Number.isInteger(marketId) || typeof raw.symbol !== "string" || raw.market_type !== "perp") return null;
  return {
    marketId,
    symbol: raw.symbol,
    status: str(raw.status),
    sizeDecimals: Number(raw.size_decimals),
    priceDecimals: Number(raw.price_decimals),
    minBaseAmount: str(raw.min_base_amount),
    minQuoteAmount: str(raw.min_quote_amount),
    maxLeverage: imf > 0 ? Math.floor(10_000 / imf) : 0,
    maintenanceMarginFraction: Number(raw.maintenance_margin_fraction),
    markPrice: str(raw.mark_price),
    indexPrice: str(raw.index_price),
    dailyPriceChangePct: typeof raw.daily_price_change === "number" ? raw.daily_price_change : null,
    openInterest: str(raw.open_interest),
  };
}

export function parseAccount(raw: Record<string, unknown>): LighterAccountState {
  const assets = Array.isArray(raw.assets) ? (raw.assets as Array<Record<string, unknown>>) : [];
  const positions = Array.isArray(raw.positions) ? (raw.positions as Array<Record<string, unknown>>) : [];
  return {
    accountIndex: Number(raw.account_index ?? raw.index),
    l1Address: str(raw.l1_address),
    collateral: str(raw.collateral),
    availableBalance: str(raw.available_balance),
    totalAssetValue: str(raw.total_asset_value),
    collateralAssets: assets
      .filter((a) => a.margin_mode === "enabled")
      .map((a) => ({ symbol: str(a.symbol), marginBalance: str(a.margin_balance) })),
    positions: positions.map((p) => {
      return {
        marketId: Number(p.market_id),
        symbol: str(p.symbol),
        size: str(p.position),
        sign: Number(p.sign),
        avgEntryPrice: str(p.avg_entry_price),
        unrealizedPnl: str(p.unrealized_pnl),
        realizedPnl: str(p.realized_pnl),
        liquidationPrice: p.liquidation_price == null ? null : str(p.liquidation_price),
        totalFundingPaidOut: str(p.total_funding_paid_out),
        allocatedMargin: str(p.allocated_margin),
        marginMode: Number(p.margin_mode ?? 0),
      };
    }),
  };
}

export class LighterClient {
  constructor(
    readonly config: LighterConfig = getLighterConfig(),
    private readonly fetcher: Fetcher = (url, headers) => fetch(url, { cache: "no-store", headers }),
  ) {}

  /** Confirms the API host serves the configured network's rollup. */
  async assertNetwork(): Promise<void> {
    const info = await getJson(`${this.config.apiOrigin}/info`, this.fetcher);
    const reported = typeof info.contract_address === "string" ? info.contract_address : "";
    if (!isAddress(reported) || getAddress(reported) !== getAddress(this.config.rollupContract)) {
      throw new LighterApiError(
        "wrong_network",
        `Lighter ${this.config.network} API reports rollup ${reported || "?"}, expected ${this.config.rollupContract}`,
      );
    }
  }

  async getMarkets(): Promise<LighterMarket[]> {
    const body = await getJson(`${this.config.apiBaseUrl}/orderBookDetails`, this.fetcher);
    if (!Array.isArray(body.order_book_details)) throw new LighterApiError("bad_response", "missing order_book_details");
    return (body.order_book_details as Array<Record<string, unknown>>)
      .map(parseMarket)
      .filter((m): m is LighterMarket => m !== null);
  }

  /** Account indexes owned by an EVM (L1) address; [] if none exist. */
  async getSubAccounts(l1Address: string): Promise<LighterSubAccount[]> {
    if (!isAddress(l1Address)) throw new LighterApiError("bad_response", "l1Address must be an EVM address");
    try {
      const body = await getJson(
        `${this.config.apiBaseUrl}/accountsByL1Address?l1_address=${getAddress(l1Address)}`,
        this.fetcher,
      );
      const subs = Array.isArray(body.sub_accounts) ? (body.sub_accounts as Array<Record<string, unknown>>) : [];
      return subs.map((s) => ({
        accountIndex: Number(s.index),
        l1Address: str(s.l1_address),
        collateral: str(s.collateral),
        accountType: Number(s.account_type),
      }));
    } catch (error) {
      if (error instanceof LighterApiError && error.kind === "not_found") return [];
      throw error;
    }
  }

  async getAccount(accountIndex: number): Promise<LighterAccountState> {
    if (!Number.isSafeInteger(accountIndex) || accountIndex < 0) {
      throw new LighterApiError("bad_response", "accountIndex must be a non-negative integer");
    }
    const body = await getJson(`${this.config.apiBaseUrl}/account?by=index&value=${accountIndex}`, this.fetcher);
    const accounts = Array.isArray(body.accounts) ? (body.accounts as Array<Record<string, unknown>>) : [];
    if (accounts.length === 0) throw new LighterApiError("not_found", `Lighter account ${accountIndex} not found`);
    return parseAccount(accounts[0]);
  }

  /** Registered API key(s) for an account slot — public data. */
  async getApiKeys(accountIndex: number, apiKeyIndex: number): Promise<LighterApiKeyRecord[]> {
    let body: Record<string, unknown>;
    try {
      body = await getJson(
        `${this.config.apiBaseUrl}/apikeys?account_index=${accountIndex}&api_key_index=${apiKeyIndex}`,
        this.fetcher,
      );
    } catch (error) {
      // Live-verified: an empty slot answers "api key not found".
      if (error instanceof LighterApiError && error.kind === "not_found") return [];
      throw error;
    }
    const keys = Array.isArray(body.api_keys) ? (body.api_keys as Array<Record<string, unknown>>) : [];
    return keys.map((k) => ({
      accountIndex: Number(k.account_index),
      apiKeyIndex: Number(k.api_key_index),
      nonce: Number(k.nonce),
      publicKey: str(k.public_key),
    }));
  }

  /** Active orders — requires an auth token from the account's API key. */
  async getActiveOrders(accountIndex: number, authToken: string, marketId?: number): Promise<LighterOrder[]> {
    const market = marketId === undefined ? "" : `&market_id=${marketId}`;
    const body = await getJson(
      `${this.config.apiBaseUrl}/accountActiveOrders?account_index=${accountIndex}${market}`,
      this.fetcher,
      { authorization: authToken },
    );
    const orders = Array.isArray(body.orders) ? (body.orders as Array<Record<string, unknown>>) : [];
    return orders.map((o) => ({
      orderIndex: Number(o.order_index),
      clientOrderIndex: Number(o.client_order_index),
      marketIndex: Number(o.market_index),
      isAsk: o.is_ask === true || o.is_ask === 1,
      type: str(o.type),
      timeInForce: str(o.time_in_force),
      reduceOnly: o.reduce_only === true || o.reduce_only === 1,
      price: str(o.price),
      initialBaseAmount: str(o.initial_base_amount),
      remainingBaseAmount: str(o.remaining_base_amount),
      filledBaseAmount: str(o.filled_base_amount),
      status: str(o.status),
    }));
  }

  /** Market funding-rate history — public. */
  async getFundingRates(marketId: number, hours = 24): Promise<LighterFundingRate[]> {
    const end = Math.floor(Date.now() / 1000);
    const body = await getJson(
      `${this.config.apiBaseUrl}/fundings?market_id=${marketId}&resolution=1h&start_timestamp=${end - hours * 3600}&end_timestamp=${end}&count_back=${hours}`,
      this.fetcher,
    );
    const rows = Array.isArray(body.fundings) ? (body.fundings as Array<Record<string, unknown>>) : [];
    return rows.map((f) => ({ timestamp: Number(f.timestamp), value: str(f.value), rate: str(f.rate), direction: str(f.direction) }));
  }

  /** The account's own funding payments — requires an auth token. */
  async getPositionFunding(accountIndex: number, authToken: string, limit = 50): Promise<LighterPositionFunding[]> {
    const body = await getJson(
      `${this.config.apiBaseUrl}/positionFunding?account_index=${accountIndex}&limit=${limit}`,
      this.fetcher,
      { authorization: authToken },
    );
    const rows = Array.isArray(body.position_fundings) ? (body.position_fundings as Array<Record<string, unknown>>) : [];
    return rows.map((f) => ({
      timestamp: Number(f.timestamp), marketId: Number(f.market_id), change: str(f.change), rate: str(f.rate),
      positionSize: str(f.position_size), positionSide: str(f.position_side),
    }));
  }
}
