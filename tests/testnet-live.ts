/**
 * Controlled Robinhood TESTNET live acceptance. Never selects mainnet.
 * Not part of `npm test`; run explicitly with `npm run test:testnet-live`.
 *
 * Covers: Robinhood agent signing (sign only, never broadcast), Uniswap v4
 * quote reads, and read-only Lighter API reads.
 *
 * Consolidated from: test-robinhood-agent-signing-live.ts, test-robinhood-v4-live.ts.
 * Each original suite runs in its own function scope.
 */
import { config as loadEnv } from "dotenv";
import * as crypto from "node:crypto";
loadEnv({ path: ".env.local" });
if (!process.env.AGENT_WALLET_ENCRYPTION_KEY?.trim()) {
  process.env.AGENT_WALLET_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
}

import { encodeFunctionData, getAddress, parseTransaction, type Address } from "viem";
import { getRobinhoodPublicClient, RobinhoodRpcError, assertCorrectChain } from "@/lib/chain/rpc";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { resolveRobinhoodExecutionConfig } from "@/lib/chain/robinhood-execution-config";
import { generateRobinhoodAgentWallet, type AgentWalletBotRow } from "@/lib/chain/robinhood-agent-wallet";
import { signRobinhoodTransaction } from "@/lib/chain/robinhood-agent-signing";
import type { UnsignedTransaction } from "@/lib/chain/robinhood-v4-swap-tx";
import { NATIVE_CURRENCY, validatePoolKey, type PoolKey } from "@/lib/chain/robinhood-v4-pool";
import { quoteSwap } from "@/lib/chain/robinhood-v4-quote";
import { LighterApiError, LighterClient } from "@/lib/lighter/client";

async function robinhood_agent_signing_live(): Promise<void> {
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
      console.log(`[SKIP] NEXT_PUBLIC_ROBINHOOD_NETWORK="${ROBINHOOD_NETWORK}" - this live check only runs against testnet.`);
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
        console.log(`[SKIP] Robinhood testnet RPC unreachable - skipping live check: ${error instanceof Error ? error.message : String(error)}`);
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

    // Live gas estimation for this specific call - allowed (read-only).
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
    if (failures !== 0) process.exitCode = 1;
  }


  await main();
}

async function robinhood_v4_live(): Promise<void> {
  let failures = 0;

  function assert(condition: boolean, label: string): void {
    if (!condition) {
      console.error(`[FAIL] ${label}`);
      failures++;
    } else {
      console.log(`[PASS] ${label}`);
    }
  }

  // The exact pool the PR08 testnet swap audit (git history) verified -
  // reproduced here to confirm this adapter's code path gets the same
  // result the audit got by hand. This is a testnet dev-test token, not a
  // production one; nothing in the adapter hardcodes it.
  const AUDIT_FIXTURE_POOL_KEY: PoolKey = {
    currency0: NATIVE_CURRENCY,
    currency1: "0xf0EA05Cd5FD14189b80616eF36bE2caefd389D4E",
    fee: 20000,
    tickSpacing: 60,
    hooks: NATIVE_CURRENCY,
  };

  async function main() {
    if (ROBINHOOD_NETWORK !== "testnet") {
      console.log(
        `[SKIP] NEXT_PUBLIC_ROBINHOOD_NETWORK="${ROBINHOOD_NETWORK}" - this live check only runs against testnet.`
      );
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

    try {
      await assertCorrectChain(client);
      assert(true, `RPC reports the expected chain id (${ROBINHOOD_CHAIN_ID})`);
    } catch (error) {
      if (error instanceof RobinhoodRpcError && error.code === "rpc_unavailable") {
        console.log(`[SKIP] Robinhood testnet RPC unreachable - skipping live check: ${error.message}`);
        return;
      }
      throw error;
    }

    for (const [label, address] of Object.entries({
      poolManager: config.poolManager,
      quoter: config.quoter,
      stateView: config.stateView,
      universalRouter: config.universalRouter,
    })) {
      const code = await client.getCode({ address });
      assert(!!code && code !== "0x", `${label} (${address}) has deployed bytecode on testnet`);
    }

    // §21b: pool validates with real, non-zero liquidity.
    const validated = await validatePoolKey(AUDIT_FIXTURE_POOL_KEY, config);
    assert(validated.ok, `audit fixture pool validates against live StateView (${!validated.ok ? validated.reason : "ok"})`);
    if (validated.ok) {
      assert(validated.pool.liquidity > BigInt(0), "audit fixture pool has non-zero live liquidity");
      assert(validated.pool.isHookless, "audit fixture pool is hookless, matching the audit's record");
    }

    // §21c: bidirectional quotes both succeed with a positive output.
    const buyQuote = await quoteSwap({
      config,
      poolKey: AUDIT_FIXTURE_POOL_KEY,
      side: "buy",
      amountIn: BigInt(100_000_000_000_000), // 0.0001 ETH, same magnitude as the audit
      slippageBps: 500,
    });
    assert(buyQuote.ok, `native ETH → token quote succeeds (${!buyQuote.ok ? buyQuote.reason : "ok"})`);
    if (buyQuote.ok) {
      assert(buyQuote.quote.amountOutQuoted > BigInt(0), "buy quote amountOutQuoted is positive");
      assert(buyQuote.quote.amountOutMinimum > BigInt(0), "buy quote amountOutMinimum is positive");
      assert(buyQuote.quote.currencyIn === NATIVE_CURRENCY, "buy quote currencyIn is native ETH");
    }

    const sellQuote = await quoteSwap({
      config,
      poolKey: AUDIT_FIXTURE_POOL_KEY,
      side: "sell",
      amountIn: BigInt("1000000000000000000"), // 1.0 token, same magnitude as the audit
      slippageBps: 500,
    });
    assert(sellQuote.ok, `token → native ETH quote succeeds (${!sellQuote.ok ? sellQuote.reason : "ok"})`);
    if (sellQuote.ok) {
      assert(sellQuote.quote.amountOutQuoted > BigInt(0), "sell quote amountOutQuoted is positive");
      assert(sellQuote.quote.currencyOut === NATIVE_CURRENCY, "sell quote currencyOut is native ETH");
    }

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    if (failures !== 0) process.exitCode = 1;
  }


  await main();
}

async function lighter_read_live(): Promise<void> {
  let failures = 0;
  function assert(condition: boolean, label: string): void {
    if (condition) console.log(`[PASS] ${label}`);
    else {
      failures++;
      console.error(`[FAIL] ${label}`);
    }
  }

  // Read-only: no account mutation, no order. Testnet only.
  if (ROBINHOOD_NETWORK !== "testnet") {
    console.log(`[SKIP] NEXT_PUBLIC_ROBINHOOD_NETWORK="${ROBINHOOD_NETWORK}" - live Lighter reads only run against testnet.`);
    return;
  }
  const c = new LighterClient();
  assert(c.config.network === "testnet", "Lighter client follows the testnet network");
  try {
    await c.assertNetwork();
    assert(true, `live: ${c.config.network} Lighter API serves expected rollup ${c.config.rollupContract}`);
    const markets = await c.getMarkets();
    assert(markets.length > 0 && markets.every((x) => x.maxLeverage > 0), `live: ${markets.length} perp markets with leverage limits`);
    const subs = await c.getSubAccounts("0x0000000000000000000000000000000000000001");
    if (subs.length > 0) {
      const a = await c.getAccount(subs[0].accountIndex);
      assert(a.accountIndex === subs[0].accountIndex, `live: account ${a.accountIndex} readable (collateral ${a.collateralAssets.map((x) => x.symbol).join(",") || "none"})`);
      assert(Array.isArray(await c.getApiKeys(subs[0].accountIndex, 2)), "live: empty api key slot reads as [] (not an error)");
    }
    const rates = await c.getFundingRates(markets[0].marketId, 3);
    assert(Array.isArray(rates), `live: funding rates readable (${rates.length} points)`);
  } catch (error) {
    if (error instanceof LighterApiError && error.kind === "unavailable") console.log(`[SKIP] live Lighter unreachable: ${error.message}`);
    else throw error;
  }
  if (failures !== 0) process.exitCode = 1;
}

async function runAll(): Promise<void> {
  console.log("\n=== robinhood-agent-signing-live ===");
  try {
    await robinhood_agent_signing_live();
  } catch (error) {
    console.error("[FAIL] test-robinhood-agent-signing-live threw:", error);
    process.exitCode = 1;
  }
  console.log("\n=== robinhood-v4-live ===");
  try {
    await robinhood_v4_live();
  } catch (error) {
    console.error("[FAIL] test-robinhood-v4-live threw:", error);
    process.exitCode = 1;
  }
  console.log("\n=== lighter-read-live ===");
  try {
    await lighter_read_live();
  } catch (error) {
    console.error("[FAIL] lighter-read-live threw:", error);
    process.exitCode = 1;
  }
}

void runAll();
