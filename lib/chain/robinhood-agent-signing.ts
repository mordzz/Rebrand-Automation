/**
 * Robinhood Chain autonomous transaction signing — PR09.
 *
 * A narrow server-side signing boundary that takes PR08's unsigned
 * `{chainId, to, data, value}` objects and produces a signed raw
 * transaction, OFFLINE — this module never calls
 * `eth_sendRawTransaction` or any broadcast primitive. Sending is PR10's
 * job. This module does not rebuild swap calldata either — that stays
 * PR08's job (lib/chain/robinhood-v4-swap-tx.ts).
 *
 * This is deliberately NOT a generic arbitrary-contract signer. It only
 * signs a transaction whose `to` is one of a small, intent-scoped
 * allowlist: the verified UniversalRouter for a swap, the verified
 * Permit2 contract for a Permit2 authorization, or the specific ERC-20
 * token an ERC-20-approval transaction says it's for. Anything else is
 * refused before the key is ever touched.
 *
 * TESTNET ONLY — see assertTestnetSigningEnabled below. Mainnet
 * autonomous signing is not implemented and fails closed with an
 * explicit message, not silently disabled behind an env flag someone
 * could accidentally flip on.
 */
import { getAddress, type Address, type Hex } from "viem";

import { ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { getRobinhoodPublicClient } from "@/lib/chain/rpc";
import {
  assertExecutionConfigOnActiveNetwork,
  resolveRobinhoodExecutionConfig,
  type RobinhoodExecutionConfig,
} from "@/lib/chain/robinhood-execution-config";
import { loadRobinhoodAgentAccount, type AgentWalletBotRow } from "@/lib/chain/robinhood-agent-wallet";
import type { UnsignedTransaction } from "@/lib/chain/robinhood-v4-swap-tx";

/** What kind of unsigned transaction is being signed — determines the
 * allowed `to` target. Never a free-form/unscoped signer. */
export type SigningIntent = "swap" | "erc20_approval" | "permit2_authorization";

export type SignRobinhoodTransactionInput = {
  bot: AgentWalletBotRow;
  unsignedTransaction: UnsignedTransaction;
  intent: SigningIntent;
  /** Required, and only meaningful, for intent === "erc20_approval": the
   * specific ERC-20 token this approval transaction targets. The signer
   * refuses to sign an "erc20_approval" transaction without this — an
   * approval's allowed target is never "any ERC-20", only the one the
   * caller explicitly names. */
  approvalToken?: Address;
};

export type SignedRobinhoodTransaction = {
  chainId: number;
  to: Address;
  value: bigint;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Signed, RLP-encoded raw transaction — ready for
   * `eth_sendRawTransaction`, which THIS module never calls. */
  signedRawTransaction: Hex;
};

/**
 * PR09 is Robinhood TESTNET only. Mainnet autonomous signing is
 * unimplemented and must fail closed with this exact message rather than
 * silently proceeding — there is deliberately no env flag that enables
 * it, so a misconfigured environment variable can't accidentally turn
 * this on.
 */
function assertTestnetSigningEnabled(): void {
  if (ROBINHOOD_NETWORK !== "testnet") {
    throw new Error("Robinhood mainnet autonomous signing is not enabled");
  }
}

function allowedTargetsForIntent(
  intent: SigningIntent,
  config: RobinhoodExecutionConfig,
  approvalToken?: Address
): Address[] {
  switch (intent) {
    case "swap":
      return [config.universalRouter];
    case "permit2_authorization":
      return [config.permit2];
    case "erc20_approval":
      if (!approvalToken) {
        throw new Error('signRobinhoodTransaction: intent "erc20_approval" requires approvalToken');
      }
      return [approvalToken];
    default: {
      const exhaustive: never = intent;
      throw new Error(`signRobinhoodTransaction: unknown intent "${exhaustive}"`);
    }
  }
}

/**
 * Pure validation of a signing request against the resolved execution
 * config — no RPC, no key material touched. Split out so it can be
 * exercised directly in deterministic tests. Throws (never returns a
 * "maybe") on:
 *   - mainnet (assertTestnetSigningEnabled)
 *   - a bot with no recorded agentNetwork, or one that doesn't resolve to
 *     a known execution config
 *   - unsignedTransaction.chainId not matching that config's chainId
 *   - unsignedTransaction.to not on the intent-scoped allowlist
 *   - unsignedTransaction.value negative
 *   - unsignedTransaction.data empty/"0x"
 */
export function validateSignRobinhoodTransactionInput(
  input: SignRobinhoodTransactionInput
): { config: RobinhoodExecutionConfig; to: Address } {
  assertTestnetSigningEnabled();

  if (input.bot.agentNetwork === null) {
    throw new Error("signRobinhoodTransaction: bot has no agentNetwork recorded");
  }
  const configResult = resolveRobinhoodExecutionConfig(input.bot.agentNetwork as RobinhoodExecutionConfig["network"]);
  if (!configResult.ok) {
    throw new Error(`signRobinhoodTransaction: execution config unavailable: ${configResult.reason}`);
  }
  const config = configResult.config;

  if (input.unsignedTransaction.chainId !== config.chainId) {
    throw new Error(
      `signRobinhoodTransaction: unsignedTransaction.chainId ${input.unsignedTransaction.chainId} does not ` +
        `match the resolved execution config's chainId ${config.chainId}`
    );
  }

  const allowedTargets = allowedTargetsForIntent(input.intent, config, input.approvalToken);
  const to = getAddress(input.unsignedTransaction.to);
  const isAllowedTarget = allowedTargets.some((target) => getAddress(target) === to);
  if (!isAllowedTarget) {
    throw new Error(
      `signRobinhoodTransaction: unsignedTransaction.to (${to}) is not an allowed target for intent ` +
        `"${input.intent}" (allowed: ${allowedTargets.join(", ")})`
    );
  }

  if (input.unsignedTransaction.value < BigInt(0)) {
    throw new Error("signRobinhoodTransaction: unsignedTransaction.value must be non-negative");
  }
  if (!input.unsignedTransaction.data || input.unsignedTransaction.data === "0x") {
    throw new Error("signRobinhoodTransaction: unsignedTransaction.data must be present (non-empty calldata)");
  }

  return { config, to };
}

/** RPC-dependent transaction-preparation primitives, injectable for
 * deterministic tests. Production callers should never pass `deps` — the
 * real implementations (live testnet RPC reads) are the defaults. */
export type SignRobinhoodTransactionDeps = {
  assertNetwork?: typeof assertExecutionConfigOnActiveNetwork;
  getNonce?: (address: Address) => Promise<number>;
  estimateFeesPerGas?: () => Promise<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }>;
  estimateGas?: (params: { account: Address; to: Address; data: Hex; value: bigint }) => Promise<bigint>;
};

/**
 * Signs a PR08-built unsigned transaction for a bot's Robinhood agent
 * wallet. Runs `validateSignRobinhoodTransactionInput` first (no RPC, no
 * key material), then the execution-config/active-network guard
 * (`assertExecutionConfigOnActiveNetwork` — also verifies the RPC itself
 * reports the expected chain id), then loads and verifies the agent
 * account (`loadRobinhoodAgentAccount`'s own fail-closed checks).
 *
 * Prepares nonce/gas/EIP-1559 fee fields from live chain RPC reads (never
 * invented — no floating point, no guessed gas price), signs OFFLINE via
 * the account's own `signTransaction`, and returns the signed raw
 * transaction. Never broadcasts.
 */
export async function signRobinhoodTransaction(
  input: SignRobinhoodTransactionInput,
  deps: SignRobinhoodTransactionDeps = {}
): Promise<SignedRobinhoodTransaction> {
  const { config, to } = validateSignRobinhoodTransactionInput(input);

  const client = getRobinhoodPublicClient();
  const assertNetwork = deps.assertNetwork ?? assertExecutionConfigOnActiveNetwork;
  await assertNetwork(config, client);

  const { account } = await loadRobinhoodAgentAccount(input.bot);

  const getNonce = deps.getNonce ?? ((address: Address) => client.getTransactionCount({ address, blockTag: "pending" }));
  const estimateFeesPerGas = deps.estimateFeesPerGas ?? (() => client.estimateFeesPerGas());
  const estimateGas =
    deps.estimateGas ??
    ((params: { account: Address; to: Address; data: Hex; value: bigint }) => client.estimateGas(params));

  const [nonce, feesPerGas, gas] = await Promise.all([
    getNonce(account.address),
    estimateFeesPerGas(),
    estimateGas({
      account: account.address,
      to,
      data: input.unsignedTransaction.data,
      value: input.unsignedTransaction.value,
    }),
  ]);

  if (feesPerGas.maxFeePerGas === undefined || feesPerGas.maxPriorityFeePerGas === undefined) {
    // A deliberate undefined check, not truthiness: a legitimate fee
    // field can be exactly 0n (falsy), which must not be confused with
    // "the RPC didn't return this field at all".
    throw new Error("signRobinhoodTransaction: RPC did not return EIP-1559 fee fields");
  }

  const signedRawTransaction = await account.signTransaction({
    chainId: config.chainId,
    to,
    data: input.unsignedTransaction.data,
    value: input.unsignedTransaction.value,
    nonce,
    gas,
    maxFeePerGas: feesPerGas.maxFeePerGas,
    maxPriorityFeePerGas: feesPerGas.maxPriorityFeePerGas,
    type: "eip1559",
  });

  return {
    chainId: config.chainId,
    to,
    value: input.unsignedTransaction.value,
    nonce,
    gas,
    maxFeePerGas: feesPerGas.maxFeePerGas,
    maxPriorityFeePerGas: feesPerGas.maxPriorityFeePerGas,
    signedRawTransaction,
  };
}
