/**
 * Read-only / offline Robinhood Chain TESTNET live check for the PR09
 * autonomous agent wallet/signing layer.
 *
 * Allowed against live testnet: chain id, nonce, gas estimation, fee
 * estimation, balance read. Generates a fresh agent wallet and signs a
 * real ERC-20 approval transaction OFFLINE using live-fetched
 * nonce/gas/fee data — the signed raw transaction is decoded and
 * compared against what was requested, but it is NEVER broadcast: this
 * script never calls eth_sendRawTransaction or any wallet "send"
 * primitive.
 *
 * Run: npm run test:robinhood-agent-signing-live
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import * as crypto from "node:crypto";
if (!process.env.AGENT_WALLET_ENCRYPTION_KEY?.trim()) {
  process.env.AGENT_WALLET_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
}

import { encodeFunctionData, getAddress, parseTransaction, type Address } from "viem";

import { getRobinhoodPublicClient, RobinhoodRpcError } from "@/lib/chain/rpc";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { resolveRobinhoodExecutionConfig } from "@/lib/chain/robinhood-execution-config";
import { generateRobinhoodAgentWallet, type AgentWalletBotRow } from "@/lib/chain/robinhood-agent-wallet";
import { signRobinhoodTransaction } from "@/lib/chain/robinhood-agent-signing";
import type { UnsignedTransaction } from "@/lib/chain/robinhood-v4-swap-tx";

let failures = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`[FAIL] ${label}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

async function main() {
  if (ROBINHOOD_NETWORK !== "testnet") {
    console.log(`[SKIP] NEXT_PUBLIC_ROBINHOOD_NETWORK="${ROBINHOOD_NETWORK}" — this live check only runs against testnet.`);
    process.exitCode = 0;
    return;
  }

  const configResult = resolveRobinhoodExecutionConfig("testnet");
  if (!configResult.ok) {
    console.error(`[FAIL] resolveRobinhoodExecutionConfig("testnet") unexpectedly failed: ${configResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const { config } = configResult;
  const client = getRobinhoodPublicClient();

  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch (error) {
    if (error instanceof RobinhoodRpcError || (error instanceof Error && /fetch|network|ECONNREFUSED|ENOTFOUND/i.test(error.message))) {
      console.log(`[SKIP] Robinhood testnet RPC unreachable — skipping live check: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 0;
      return;
    }
    throw error;
  }
  assert(chainId === ROBINHOOD_CHAIN_ID, `RPC reports the expected chain id (${ROBINHOOD_CHAIN_ID})`);

  const wallet = await generateRobinhoodAgentWallet();
  console.log(`Generated a throwaway agent address for this live check: ${wallet.address} (never funded, never reused).`);

  // Allowed read-only primitives against live testnet.
  const nonce = await client.getTransactionCount({ address: wallet.address, blockTag: "pending" });
  assert(Number.isInteger(nonce) && nonce >= 0, `live nonce read succeeds (nonce=${nonce})`);

  const balance = await client.getBalance({ address: wallet.address });
  assert(balance === BigInt(0), "a freshly generated, never-funded address has a live balance of exactly 0");

  const feesPerGas = await client.estimateFeesPerGas();
  assert(
    typeof feesPerGas.maxFeePerGas === "bigint" && feesPerGas.maxFeePerGas > BigInt(0),
    "live EIP-1559 fee estimation returns a positive maxFeePerGas"
  );

  const approvalToken: Address = "0xf0EA05Cd5FD14189b80616eF36bE2caefd389D4E"; // audit fixture token, read-only use
  const approvalData = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [config.permit2, BigInt(1000)],
  });
  const unsignedTransaction: UnsignedTransaction = {
    chainId: config.chainId,
    to: approvalToken,
    data: approvalData,
    value: BigInt(0),
  };

  const bot: AgentWalletBotRow = {
    agentChain: "robinhood",
    agentNetwork: "testnet",
    agentPublicKey: wallet.address,
    agentSecretEnc: wallet.secretEnc,
  };

  // Live gas estimation for this specific call — allowed (read-only).
  const gas = await client.estimateGas({
    account: wallet.address,
    to: approvalToken,
    data: approvalData,
    value: BigInt(0),
  });
  assert(gas > BigInt(0), `live gas estimation for the approval call succeeds (gas=${gas})`);

  // Signs OFFLINE using the live-fetched nonce/fee/gas above. This
  // script never calls eth_sendRawTransaction or walletClient.sendTransaction.
  const signed = await signRobinhoodTransaction(
    { bot, unsignedTransaction, intent: "erc20_approval", approvalToken },
    {
      getNonce: async () => nonce,
      estimateFeesPerGas: async () => feesPerGas,
      estimateGas: async () => gas,
    }
  );
  assert(!!signed.signedRawTransaction, "offline signing succeeds using live-fetched nonce/fee/gas");

  const decoded = parseTransaction(signed.signedRawTransaction);
  assert(decoded.chainId === config.chainId, "decoded signed tx chainId matches the live chain");
  assert(getAddress(decoded.to as Address) === getAddress(approvalToken), "decoded signed tx to matches the intended approval token");
  assert(decoded.data === approvalData, "decoded signed tx data matches the intended approval calldata");
  assert(decoded.nonce === nonce, "decoded signed tx nonce matches the live-fetched nonce");

  console.log(
    "\nNo broadcast was performed. This script never called eth_sendRawTransaction or any wallet.sendTransaction primitive."
  );
  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("[FAIL] unexpected error:", error);
  process.exitCode = 1;
});
