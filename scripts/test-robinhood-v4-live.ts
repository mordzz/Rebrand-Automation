/**
 * Read-only Robinhood Chain TESTNET live integration check for the PR08B
 * v4 execution adapter.
 *
 * Verifies: correct chain id, bytecode presence for Quoter / PoolManager /
 * UniversalRouter / StateView, and reproduces
 * ROBINHOOD_SWAP_EXECUTION_AUDIT.md §21b/§21c's native-ETH pool
 * validation + bidirectional quote by hand through this adapter's own
 * `validatePoolKey`/`quoteSwap` — as verification that the new code
 * reproduces the audit's result, NOT as a hardcoded production pool.
 *
 * No transaction is sent. No signing. No GMGN dependency. Requires network
 * access to Robinhood testnet; skips (exit 0) with a clear message if the
 * RPC is unreachable, rather than failing CI on a transient network issue.
 *
 * Run: npm run test:robinhood-v4-live
 */
import { getRobinhoodPublicClient, assertCorrectChain, RobinhoodRpcError } from "@/lib/chain/rpc";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { resolveRobinhoodExecutionConfig } from "@/lib/chain/robinhood-execution-config";
import { NATIVE_CURRENCY, validatePoolKey, type PoolKey } from "@/lib/chain/robinhood-v4-pool";
import { quoteSwap } from "@/lib/chain/robinhood-v4-quote";

let failures = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`[FAIL] ${label}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

// The exact pool ROBINHOOD_SWAP_EXECUTION_AUDIT.md §21b verified —
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
      `[SKIP] NEXT_PUBLIC_ROBINHOOD_NETWORK="${ROBINHOOD_NETWORK}" — this live check only runs against testnet.`
    );
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

  try {
    await assertCorrectChain(client);
    assert(true, `RPC reports the expected chain id (${ROBINHOOD_CHAIN_ID})`);
  } catch (error) {
    if (error instanceof RobinhoodRpcError && error.code === "rpc_unavailable") {
      console.log(`[SKIP] Robinhood testnet RPC unreachable — skipping live check: ${error.message}`);
      process.exitCode = 0;
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
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("[FAIL] unexpected error:", error);
  process.exitCode = 1;
});
