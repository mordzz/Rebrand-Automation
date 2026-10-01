/**
 * Mainnet guard tests — POST-MIGRATION readiness.
 *
 * Proves that, even with the process pointed at Robinhood MAINNET, every
 * state-changing path still refuses:
 *   - v4 execution config resolution (mainnet → ok:false)
 *   - autonomous signing (assertTestnetSigningEnabled via the signer)
 *   - broadcasting (assertTestnetBroadcastEnabled)
 *   - Lighter order execution and API-key registration (mainnet config)
 * and that the readiness-only mainnet constants are well-formed. With
 * `--live`, re-verifies their bytecode + wiring read-only on mainnet RPC.
 * Never signs or sends anything.
 *
 * Run: npm run test:mainnet-guards [-- --live]
 */
import { spawnSync } from "node:child_process";

let failures = 0;
function assert(c: boolean, label: string) {
  if (!c) {
    console.error(`[FAIL] ${label}`);
    failures++;
  } else console.log(`[PASS] ${label}`);
}
async function refuses(fn: () => unknown, re: RegExp, label: string) {
  try {
    await fn();
    assert(false, `${label} (did not refuse)`);
  } catch (e) {
    assert(re.test(e instanceof Error ? e.message : String(e)), `${label} — ${(e as Error).message.slice(0, 80)}`);
  }
}

async function childMainnet() {
  // Imported only after NEXT_PUBLIC_ROBINHOOD_NETWORK=mainnet is set.
  const { ROBINHOOD_NETWORK, ROBINHOOD_CHAIN_ID } = await import("@/lib/chain/config");
  assert(ROBINHOOD_NETWORK === "mainnet" && ROBINHOOD_CHAIN_ID === 4663, "child process is on Robinhood mainnet (4663)");

  const { resolveRobinhoodExecutionConfig } = await import("@/lib/chain/robinhood-execution-config");
  const r = resolveRobinhoodExecutionConfig("mainnet");
  assert(!r.ok && /disabled/.test(r.reason), "mainnet v4 execution config refuses (ok:false)");

  const { signRobinhoodTransaction } = await import("@/lib/chain/robinhood-agent-signing");
  await refuses(
    () =>
      signRobinhoodTransaction({
        bot: { agentChain: "robinhood", agentNetwork: "mainnet", agentPublicKey: "0x0000000000000000000000000000000000000001", agentSecretEnc: "x" },
        unsignedTransaction: { chainId: 4663, to: "0x8876789976dEcBfCbBbe364623C63652db8C0904", data: "0x1234", value: BigInt(1) },
        intent: "swap",
      }),
    /mainnet autonomous signing is not enabled/,
    "mainnet autonomous signing refuses before any key load",
  );

  const { assertTestnetBroadcastEnabled } = await import("@/lib/chain/robinhood-broadcast");
  await refuses(() => assertTestnetBroadcastEnabled(), /mainnet broadcasting is not enabled/, "mainnet broadcasting refuses");

  const { getLighterConfig } = await import("@/lib/lighter/config");
  const { LighterExecutor } = await import("@/lib/lighter/orders");
  const { registerAgentApiKey } = await import("@/lib/lighter/registration");
  const fakeSigner = { config: getLighterConfig("mainnet") } as never;
  await refuses(() => new LighterExecutor(fakeSigner), /testnet environment only/, "Lighter mainnet order execution refuses");
  await refuses(
    () =>
      registerAgentApiKey(
        {
          agentChain: "robinhood", agentNetwork: "mainnet", agentPublicKey: "0x0000000000000000000000000000000000000001", agentSecretEnc: "x",
          lighterNetwork: null, lighterAccountIndex: null, lighterApiKeyIndex: null, lighterApiPublicKey: null, lighterApiKeyEnc: null, lighterApiKeyStatus: null,
        },
        { config: getLighterConfig("mainnet"), store: { savePending: async () => {}, markRegistered: async () => {} }, signRegistration: async () => "0x" },
      ),
    /testnet environment only/,
    "Lighter mainnet API-key registration refuses",
  );
}

async function main() {
  if (process.argv.includes("--child")) return childMainnet().then(finish);

  // ═══ Readiness-only constants ═════════════════════════════════════════
  const { ROBINHOOD_MAINNET_V4_VERIFIED: M } = await import("@/lib/chain/robinhood-execution-config");
  const { isAddress } = await import("viem");
  assert(M.chainId === 4663, "mainnet constants are for chain 4663");
  for (const k of ["poolManager", "quoter", "stateView", "positionManager", "universalRouter", "universalRouterV2_1_2", "permit2", "weth", "usdg"] as const) {
    assert(isAddress(M[k]), `mainnet ${k} is a valid address`);
  }
  assert(M.smokePool.hooks === "0x0000000000000000000000000000000000000000" && M.smokePool.currency0 === "0x0000000000000000000000000000000000000000", "smoke pool is hookless native-ETH (PR08-compatible)");

  // ═══ Guards under a mainnet-configured process ════════════════════════
  const child = spawnSync(process.execPath, [...process.execArgv, process.argv[1], "--child"], {
    env: { ...process.env, NEXT_PUBLIC_ROBINHOOD_NETWORK: "mainnet" },
    encoding: "utf8",
  });
  process.stdout.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  assert(child.status === 0, "all mainnet guards refused in a mainnet-configured process");

  // ═══ Optional live read-only re-verification ══════════════════════════
  if (process.argv.includes("--live")) {
    const { createPublicClient, http, parseAbi } = await import("viem");
    const c = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
    assert((await c.getChainId()) === 4663, "live: mainnet RPC chain id 4663");
    for (const k of ["poolManager", "quoter", "stateView", "positionManager", "universalRouter", "permit2", "weth", "usdg"] as const) {
      const code = await c.getCode({ address: M[k] });
      assert(!!code && code.length > 2, `live: ${k} has deployed bytecode`);
    }
    const pm = parseAbi(["function poolManager() view returns (address)"]);
    for (const k of ["quoter", "stateView", "universalRouter"] as const) {
      const v = await c.readContract({ address: M[k], abi: pm, functionName: "poolManager" });
      assert(v.toLowerCase() === M.poolManager.toLowerCase(), `live: ${k}.poolManager() == verified PoolManager`);
    }
  }
  finish();
}

function finish() {
  console.log(failures === 0 ? "\nAll mainnet guard tests passed." : `\n${failures} failure(s).`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
