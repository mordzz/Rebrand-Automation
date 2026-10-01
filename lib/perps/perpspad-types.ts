/** Perpspad domain model types.
 *
 * The backing perp venue is Drift Protocol, not Phoenix - an earlier pass
 * of this feature wired mock data toward a "Phoenix" perps API
 * (lib/phoenix/, since removed) that has nothing to do with Drift's
 * actual on-chain program/account model. See the Perpspad plan for the
 * chosen architecture: a program-owned PDA per token CPIs into Drift, the
 * keeper never holds unconstrained control over pooled funds. */

export type PerpsDirection = "LONG" | "SHORT";

export type PerpsTokenStatus =
  /** Row exists off-chain only - the creator's form submission was
   * recorded, but no on-chain program exists yet to act on it (Phase 0). */
  | "pending"
  | "active"
  | "low_health"
  | "liquidated"
  | "accumulating";

/** A Perpspad token - every token created on the launchpad maps to exactly
 *  one perpetual futures position on Drift Protocol. */
export interface PerpspadToken {
  /** Stable row identity, always present - unlike `mint`, which is null
   * until the token is actually registered on-chain (Phase 1+). Use this
   * for React keys / lookups on a "pending" row. */
  id: string;
  /** SPL token mint address. Null while status = "pending". */
  mint: string | null;
  /** Human-readable token name. */
  name: string;
  /** Ticker symbol, e.g. "LONGBTC". */
  symbol: string;
  /** Underlying Drift perp market symbol, e.g. "BTC", "SOL" - display
   * convenience; `underlyingMarketIndex` is the real on-chain identity. */
  underlying: string;
  /** Drift's own numeric market index for `underlying` - what the program
   * actually sends Drift, never derived from the symbol string at
   * call time. */
  underlyingMarketIndex: number;
  /** Direction of the perp position. */
  direction: PerpsDirection;
  /** Target leverage requested at creation (effective leverage may drift). */
  targetLeverage: number;
  /** This token's own program-derived Drift-authority PDA - one distinct
   * authority per token (never shared across tokens), so a bug reachable
   * through one token's CPI logic can't reach another token's Drift
   * account. Null until the on-chain program registers this token. */
  driftAuthorityPda: string | null;
  /** Current lifecycle status. */
  status: PerpsTokenStatus;

  // ── Live data (populated at runtime) ───────────────────────────────
  /** Position entry price in USD. */
  entryPrice?: number;
  /** Current mark price in USD. */
  currentPrice?: number;
  /** Unrealised P&L in USD. */
  unrealizedPnl?: number;
  /** Collateral balance in USDC. */
  collateral?: number;
  /** Effective leverage = notional / collateral. */
  effectiveLeverage?: number;
  /** Health ratio 0‑1, derived from Drift's margin/maintenance requirement. */
  healthRatio?: number;
  /** Accumulated trading fees (USDC) pending distribution. */
  pendingFees?: number;
  /** Total fees ever collected (USDC). */
  totalFeesCollected?: number;
  /** Total tokens burned via buyback. */
  totalBurned?: number;
  /** Creation timestamp. */
  createdAt: number;
}

/** Parameters for launching a new Perpspad token. */
export interface CreatePerpspadTokenParams {
  name: string;
  symbol: string;
  underlying: string;
  direction: PerpsDirection;
  targetLeverage: number;
  initialCollateralUsdc: number;
}

/** Fee split configuration - percentages must sum to 100. */
export interface FeeSplitConfig {
  /** Percentage sent to top-up the perp position collateral. */
  collateralTopUp: number;
  /** Percentage used to buy back and burn the token itself. */
  tokenBuybackBurn: number;
  /** Percentage used to buy back and burn governance $PERPSPAD. */
  governanceBuybackBurn: number;
}

/** Default fee split per the Perpspad spec. */
export const DEFAULT_FEE_SPLIT: FeeSplitConfig = {
  collateralTopUp: 50,
  tokenBuybackBurn: 25,
  governanceBuybackBurn: 25,
};
