/**
 * Deterministic tests for the PR09-hardening chain-aware agent-wallet
 * view helper: lib/chain/robinhood-agent-wallet-view.ts — used by
 * GET /api/my-bot/wallet to stop routing Robinhood/EVM bots through the
 * Solana balance reader.
 *
 * No network calls — `buildRobinhoodAgentWalletView` is a pure function
 * given an already-fetched balance/error, so this exercises it directly
 * with synthetic inputs. Also statically confirms (by reading the
 * module's own source) that it never imports the Solana balance reader
 * at all — not just that the route happens not to call it.
 *
 * Run: npm run test:robinhood-agent-wallet-view
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildRobinhoodAgentWalletView, loadRobinhoodAgentAccountView } from "@/lib/chain/robinhood-agent-wallet-view";
import { ROBINHOOD_NATIVE_SYMBOL, ROBINHOOD_NETWORK } from "@/lib/chain/config";

let failures = 0;

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`[FAIL] ${label}\n  expected: ${e}\n  actual:   ${a}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

function assert(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`[FAIL] ${label}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

const AGENT_ADDRESS = "0x1111111111111111111111111111111111111111";

async function main() {
  // ═══ Robinhood balance path used, correct fields ══════════════════════
  {
    const view = buildRobinhoodAgentWalletView(
      { agentPublicKey: AGENT_ADDRESS, agentNetwork: ROBINHOOD_NETWORK },
      { balanceWei: BigInt("1500000000000000000"), error: null } // 1.5 ETH
    );
    assert(!("reason" in view), "matching network produces a real wallet view, not a network_mismatch");
    if (!("reason" in view)) {
      assertEqual(view.chain, "robinhood", "view.chain === 'robinhood'");
      assertEqual(view.network, ROBINHOOD_NETWORK, "view.network matches the active Robinhood network");
      assertEqual(view.nativeSymbol, ROBINHOOD_NATIVE_SYMBOL, "view.nativeSymbol === ETH");
      assertEqual(view.address, AGENT_ADDRESS, "view.address matches the agent's public key");
      assertEqual(view.balanceNative, "1.5", "1.5 ETH in wei formats to the decimal string '1.5'");
      assertEqual(view.sizeNative, null, "sizeNative is null — no invented required-funding number");
      assertEqual(view.requiredNative, null, "requiredNative is null — no invented required-funding number");
      assertEqual(view.sufficient, null, "sufficient is null — no invented sufficiency threshold");
      assertEqual(view.error, null, "error is null when balance read succeeded");
    }
  }
  {
    // Balance read failed — error surfaces, balanceNative stays null
    // (never reported as 0, which would look like a drained wallet).
    const view = buildRobinhoodAgentWalletView(
      { agentPublicKey: AGENT_ADDRESS, agentNetwork: ROBINHOOD_NETWORK },
      { balanceWei: null, error: "RPC unavailable" }
    );
    assert(!("reason" in view), "a balance-read failure still produces a wallet view, not a network_mismatch");
    if (!("reason" in view)) {
      assertEqual(view.balanceNative, null, "balanceNative is null when the read failed, never reported as 0");
      assertEqual(view.error, "RPC unavailable", "the read error is surfaced");
    }
  }

  // ═══ no ETH values leak into Solana-named fields ══════════════════════
  {
    const view = buildRobinhoodAgentWalletView(
      { agentPublicKey: AGENT_ADDRESS, agentNetwork: ROBINHOOD_NETWORK },
      { balanceWei: BigInt(1_000_000_000_000_000_000), error: null }
    );
    const keys = Object.keys(view);
    assert(!keys.includes("balanceSol"), "Robinhood view never includes balanceSol");
    assert(!keys.includes("sizeSol"), "Robinhood view never includes sizeSol");
    assert(!keys.includes("requiredSol"), "Robinhood view never includes requiredSol");
  }

  // ═══ network mismatch fails closed rather than reading the wrong network ═
  {
    const view = buildRobinhoodAgentWalletView(
      { agentPublicKey: AGENT_ADDRESS, agentNetwork: "mainnet" }, // active network is testnet in this env
      { balanceWei: BigInt(1), error: null }
    );
    assert("reason" in view && view.reason === "network_mismatch", "a bot recorded for a different network than the active one returns network_mismatch, never a balance");
  }
  {
    const view = buildRobinhoodAgentWalletView(
      { agentPublicKey: AGENT_ADDRESS, agentNetwork: null },
      { balanceWei: BigInt(1), error: null }
    );
    assert("reason" in view && view.reason === "network_mismatch", "a bot with no recorded agentNetwork also fails closed as network_mismatch, never assumed");
  }

  // ═══ loadRobinhoodAgentAccountView: network mismatch BEFORE any RPC read ═
  {
    let calls = 0;
    const view = await loadRobinhoodAgentAccountView(
      { agentPublicKey: AGENT_ADDRESS, agentNetwork: "mainnet" }, // active network is testnet in this env
      {
        getBalance: async () => {
          calls++;
          return BigInt(1);
        },
      }
    );
    assertEqual(calls, 0, "network mismatch: the balance dependency is called exactly 0 times");
    assert("reason" in view && view.reason === "network_mismatch", "network mismatch: loader returns network_mismatch");
  }
  {
    let calls = 0;
    const view = await loadRobinhoodAgentAccountView(
      { agentPublicKey: AGENT_ADDRESS, agentNetwork: null },
      {
        getBalance: async () => {
          calls++;
          return BigInt(1);
        },
      }
    );
    assertEqual(calls, 0, "no recorded agentNetwork: the balance dependency is called exactly 0 times");
    assert("reason" in view && view.reason === "network_mismatch", "no recorded agentNetwork: loader returns network_mismatch");
  }
  {
    let calls = 0;
    const view = await loadRobinhoodAgentAccountView(
      { agentPublicKey: AGENT_ADDRESS, agentNetwork: ROBINHOOD_NETWORK },
      {
        getBalance: async () => {
          calls++;
          return BigInt("2000000000000000000"); // 2 ETH
        },
      }
    );
    assertEqual(calls, 1, "matching network: the balance dependency is called exactly 1 time");
    assert(!("reason" in view), "matching network: loader returns a real wallet view");
    if (!("reason" in view)) {
      assertEqual(view.balanceNative, "2", "matching network: loader's view reflects the dependency's returned balance");
    }
  }
  {
    // The dependency throwing must not throw out of the loader — it
    // surfaces as a wallet-view error, same as buildRobinhoodAgentWalletView's
    // own failed-read handling.
    let calls = 0;
    const view = await loadRobinhoodAgentAccountView(
      { agentPublicKey: AGENT_ADDRESS, agentNetwork: ROBINHOOD_NETWORK },
      {
        getBalance: async () => {
          calls++;
          throw new Error("simulated RPC failure");
        },
      }
    );
    assertEqual(calls, 1, "matching network + failed read: the balance dependency is still called exactly once");
    assert(!("reason" in view), "matching network + failed read: loader still returns a real wallet view, not network_mismatch");
    if (!("reason" in view)) {
      assertEqual(view.balanceNative, null, "matching network + failed read: balanceNative is null, not 0");
      assertEqual(view.error, "simulated RPC failure", "matching network + failed read: the dependency's error message is surfaced");
    }
  }

  // ═══ structural: the Robinhood view module never references the Solana
  // balance reader at all — not just "the route doesn't call it today" ═
  {
    const source = readFileSync(
      join(process.cwd(), "lib", "chain", "robinhood-agent-wallet-view.ts"),
      "utf8"
    );
    assert(!/from ["']@\/lib\/solana/i.test(source), "lib/chain/robinhood-agent-wallet-view.ts imports nothing from lib/solana/* (doc-comment mentions of \"Solana\" for context are fine)");
    assert(!source.includes("getAddressBalance"), "lib/chain/robinhood-agent-wallet-view.ts never imports/calls getAddressBalance (the Solana balance reader)");
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("[FAIL] unexpected error:", error);
  process.exitCode = 1;
});
