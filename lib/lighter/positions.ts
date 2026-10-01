/**
 * Lighter positions / PnL / margin mapping - PR12.
 *
 * Maps PR11's read-only account state into Noah's perps view. Direction
 * follows Lighter's official example (lighter-python
 * examples/orders/create_stop_loss_market_order.py treats `sign == 1` with
 * a positive size as a long): 1 → long, -1 → short. A zero size is flat.
 * Any other sign is reported "unknown" rather than guessed. All money
 * values stay decimal strings exactly as Lighter reports them.
 */
import type { LighterAccountState, LighterPosition } from "@/lib/lighter/client";

export type PerpPositionView = {
  marketId: number;
  symbol: string;
  side: "long" | "short" | "flat" | "unknown";
  size: string;
  avgEntryPrice: string;
  unrealizedPnl: string;
  realizedPnl: string;
  liquidationPrice: string | null;
  totalFundingPaidOut: string;
  allocatedMargin: string;
  /** Official constants: CROSS_MARGIN_MODE = 0, ISOLATED_MARGIN_MODE = 1. */
  marginMode: "cross" | "isolated" | "unknown";
};

export type PerpAccountView = {
  accountIndex: number;
  collateralAssets: LighterAccountState["collateralAssets"];
  collateral: string;
  availableBalance: string;
  totalAssetValue: string;
  positions: PerpPositionView[];
};

const isZero = (v: string) => /^-?0*(\.0*)?$/.test(v.trim());

export function positionSide(p: Pick<LighterPosition, "sign" | "size">): PerpPositionView["side"] {
  if (isZero(p.size)) return "flat";
  if (p.sign === 1) return "long";
  if (p.sign === -1) return "short";
  return "unknown";
}

export function toPerpAccountView(a: LighterAccountState): PerpAccountView {
  return {
    accountIndex: a.accountIndex,
    collateralAssets: a.collateralAssets,
    collateral: a.collateral,
    availableBalance: a.availableBalance,
    totalAssetValue: a.totalAssetValue,
    positions: a.positions
      .map((p) => ({
        marketId: p.marketId,
        symbol: p.symbol,
        side: positionSide(p),
        size: p.size,
        avgEntryPrice: p.avgEntryPrice,
        unrealizedPnl: p.unrealizedPnl,
        realizedPnl: p.realizedPnl,
        liquidationPrice: p.liquidationPrice,
        totalFundingPaidOut: p.totalFundingPaidOut,
        allocatedMargin: p.allocatedMargin,
        marginMode: (p.marginMode === 0 ? "cross" : p.marginMode === 1 ? "isolated" : "unknown") as PerpPositionView["marginMode"],
      }))
      .filter((p) => p.side !== "flat"),
  };
}
