/**
 * Perpspad token launch — FAILS CLOSED (PR09A).
 *
 * The Solana `register_token` transaction builder was retired with the
 * Solana runtime. The Robinhood Chain (Lighter) replacement is PR11–PR13;
 * no launch transaction is built until then.
 */
import { PERPS_MIGRATION_MESSAGE } from "@/lib/perps/program";

export type BuildLaunchTxParams = {
  creatorWallet: string;
  name: string;
  symbol: string;
  underlyingMarketIndex: number;
  direction: "LONG" | "SHORT";
  targetLeverage: number;
};

export class PerpsLaunchUnavailableError extends Error {
  constructor() {
    super(PERPS_MIGRATION_MESSAGE);
    this.name = "PerpsLaunchUnavailableError";
  }
}

export async function buildRegisterTokenTransaction(params: BuildLaunchTxParams): Promise<never> {
  void params;
  throw new PerpsLaunchUnavailableError();
}
