/**
 * Manual verification for the PR03 Robinhood Chain read layer against
 * whatever network is configured (testnet by default). Not a CI test -
 * it hits a real RPC endpoint, same spirit as scripts/test-perpspad.ts
 * did for the Solana/Perpspad side.
 *
 * Run: npm run verify:robinhood-rpc
 */
import { config as loadEnv } from "dotenv";

// Explicit path: this repo only ships .env.local (no .env), and plain
// `dotenv/config` only loads `.env` by default.
loadEnv({ path: ".env.local" });

import {
  RobinhoodRpcError,
  assertCorrectChain,
  getLatestBlockNumber,
  getNativeBalance,
  getRobinhoodPublicClient,
} from "@/lib/chain/rpc";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_NETWORK, ROBINHOOD_RPC_URL } from "@/lib/chain/config";

// A well-known, definitely-unfunded address (Solidity's zero address) -
// PR03 explicitly does not require a funded wallet, so this only checks
// that a balance lookup for a valid address returns a number, not that
// the number is meaningful.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function main() {
  console.log(`Network:  ${ROBINHOOD_NETWORK}`);
  console.log(`Expected chain id: ${ROBINHOOD_CHAIN_ID}`);
  console.log(`RPC URL:  ${ROBINHOOD_RPC_URL}`);
  console.log();

  const client = getRobinhoodPublicClient();

  try {
    await assertCorrectChain(client);
    console.log(`[ok] chain id matches ${ROBINHOOD_CHAIN_ID}`);
  } catch (error) {
    reportFailure("chain id check", error);
    process.exitCode = 1;
    return;
  }

  try {
    const block = await getLatestBlockNumber(client);
    console.log(`[ok] latest block number: ${block.toString()}`);
  } catch (error) {
    reportFailure("latest block number", error);
    process.exitCode = 1;
    return;
  }

  try {
    const balance = await getNativeBalance(ZERO_ADDRESS, client);
    console.log(`[ok] native balance of ${ZERO_ADDRESS}: ${balance.toString()} wei`);
  } catch (error) {
    reportFailure("native balance lookup", error);
    process.exitCode = 1;
    return;
  }

  console.log();
  console.log("All PR03 read-layer checks passed against the configured Robinhood RPC.");
}

function reportFailure(step: string, error: unknown): void {
  if (error instanceof RobinhoodRpcError) {
    console.error(`[fail] ${step}: [${error.code}] ${error.message}`);
    if (error.code === "rpc_unavailable") {
      console.error(
        "        This may be an environment/network limitation (no outbound access to " +
          "Robinhood's public RPC from this container/sandbox) rather than a code defect."
      );
    }
    return;
  }
  console.error(`[fail] ${step}:`, error);
}

main().catch((error) => {
  console.error("Unexpected failure:", error);
  process.exitCode = 1;
});
