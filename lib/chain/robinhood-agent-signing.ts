/**
 * Robinhood Chain autonomous transaction signing — PR09.
 *
 * A narrow server-side signing boundary that takes PR08's unsigned
 * `{chainId, to, data, value}` objects and produces a signed raw
 * transaction, OFFLINE — this module never calls
 * `eth_sendRawTransaction` or any broadcast primitive. Sending is PR10's
 * job. This module does not rebuild swap calldata either — that stays
 * PR08's job (lib/chain/robinhood-v4-swap-tx.ts / robinhood-v4-actions.ts).
 *
 * This is deliberately NOT a generic arbitrary-contract signer, and a
 * matching `to` address alone is NOT sufficient to sign. Every intent
 * decodes the FULL calldata and validates its exact semantics — the
 * specific function, every argument, and (for swaps) the full nested
 * commands/actions/PoolKey shape — before the private key is ever
 * loaded. A transaction whose target is on the allowlist but whose
 * calldata doesn't decode to exactly the expected call is refused just
 * as hard as a transaction to the wrong address. All ABI/byte constants
 * used for decoding are imported from PR08's own encoder modules
 * (robinhood-v4-actions.ts, robinhood-v4-swap-tx.ts), never
 * hand-copied, so the two layers cannot silently drift apart.
 *
 * TESTNET ONLY — see assertTestnetSigningEnabled below. Mainnet
 * autonomous signing is not implemented and fails closed with an
 * explicit message, not silently disabled behind an env flag someone
 * could accidentally flip on.
 */
import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";

import { ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { getRobinhoodPublicClient } from "@/lib/chain/rpc";
import {
  assertExecutionConfigOnActiveNetwork,
  resolveRobinhoodExecutionConfig,
  type RobinhoodExecutionConfig,
} from "@/lib/chain/robinhood-execution-config";
import { loadRobinhoodAgentAccount, type AgentWalletBotRow } from "@/lib/chain/robinhood-agent-wallet";
import { NATIVE_CURRENCY } from "@/lib/chain/robinhood-v4-pool";
import { decodeV4SwapCommandsAndInputs } from "@/lib/chain/robinhood-v4-actions";
import {
  ERC20_ABI,
  MAX_DEADLINE_SECONDS,
  PERMIT2_ABI,
  UNIVERSAL_ROUTER_EXECUTE_ABI,
  type UnsignedTransaction,
} from "@/lib/chain/robinhood-v4-swap-tx";

/** What kind of unsigned transaction is being signed — determines both
 * the allowed `to` target AND the expected calldata shape. Never a
 * free-form/unscoped signer. */
export type SigningIntent = "swap" | "erc20_approval" | "permit2_authorization";

export type SignRobinhoodTransactionInput = {
  bot: AgentWalletBotRow;
  unsignedTransaction: UnsignedTransaction;
  intent: SigningIntent;
  /** Required for intent === "erc20_approval" (the token this approval
   * targets) AND intent === "permit2_authorization" (the token the
   * decoded Permit2 `approve()` call must name). Never inferred from the
   * calldata itself — the caller states up front what it expects, and
   * the decoded calldata must match that, not the other way around. */
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

function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/** Fails closed if `deadlineOrExpiration` isn't strictly in the future
 * and within PR08's own bounded-deadline policy
 * (`MAX_DEADLINE_SECONDS`) — the exact same bound PR08 enforces when
 * building it, never a second, possibly-drifted copy. */
function assertDeadlineWithinPolicy(deadlineOrExpiration: bigint, label: string): void {
  const now = nowSeconds();
  if (deadlineOrExpiration <= now) {
    throw new Error(`signRobinhoodTransaction: ${label} ${deadlineOrExpiration} is not in the future (now=${now})`);
  }
  const maxAllowed = now + BigInt(MAX_DEADLINE_SECONDS);
  if (deadlineOrExpiration > maxAllowed) {
    throw new Error(
      `signRobinhoodTransaction: ${label} ${deadlineOrExpiration} exceeds the bounded-deadline policy ` +
        `(max ${maxAllowed}, i.e. now + ${MAX_DEADLINE_SECONDS}s)`
    );
  }
}

/**
 * Full semantic validation of a swap-intent transaction: decodes
 * `UniversalRouter.execute()` and, within it, the exact
 * `V4_SWAP`/`SWAP_EXACT_IN_SINGLE`/`SETTLE_ALL`/`TAKE_ALL` payload PR08
 * builds — never just checking the function selector. Throws with a
 * specific reason on any deviation.
 */
function validateSwapCalldata(data: Hex, unsignedTransaction: UnsignedTransaction): void {
  let decodedExecute: { functionName: string; args: readonly unknown[] };
  try {
    decodedExecute = decodeFunctionData({ abi: UNIVERSAL_ROUTER_EXECUTE_ABI, data });
  } catch (error) {
    throw new Error(
      `signRobinhoodTransaction: swap calldata does not decode as UniversalRouter.execute(): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (decodedExecute.functionName !== "execute") {
    throw new Error(`signRobinhoodTransaction: swap calldata decoded to unexpected function "${decodedExecute.functionName}"`);
  }
  const [commands, inputs, deadline] = decodedExecute.args as [Hex, readonly Hex[], bigint];

  const decodeResult = decodeV4SwapCommandsAndInputs(commands, inputs);
  if (!decodeResult.ok) {
    throw new Error(`signRobinhoodTransaction: swap calldata rejected: ${decodeResult.reason}`);
  }
  const { exactInputSingle, settleCurrency, settleMaxAmount, takeCurrency, takeMinAmount } = decodeResult.decoded;
  const { poolKey } = exactInputSingle;

  if (getAddress(poolKey.hooks) !== getAddress(NATIVE_CURRENCY)) {
    throw new Error("signRobinhoodTransaction: swap poolKey.hooks must be the zero address (hookless only)");
  }
  if (exactInputSingle.hookData !== "0x") {
    throw new Error("signRobinhoodTransaction: swap hookData must be empty (0x) for a hookless pool");
  }

  const currency0IsNative = getAddress(poolKey.currency0) === getAddress(NATIVE_CURRENCY);
  const currency1IsNative = getAddress(poolKey.currency1) === getAddress(NATIVE_CURRENCY);
  if (currency0IsNative === currency1IsNative) {
    // Either both native (impossible/malformed) or neither native
    // (token/token — out of this adapter's verified scope).
    throw new Error("signRobinhoodTransaction: swap poolKey must have exactly one native (address(0)) currency");
  }

  if (exactInputSingle.amountIn <= BigInt(0)) {
    throw new Error("signRobinhoodTransaction: swap amountIn must be positive");
  }
  if (exactInputSingle.amountOutMinimum <= BigInt(0)) {
    throw new Error("signRobinhoodTransaction: swap amountOutMinimum must be positive");
  }
  if (settleMaxAmount !== exactInputSingle.amountIn) {
    throw new Error("signRobinhoodTransaction: swap settleMaxAmount must equal amountIn");
  }
  if (takeMinAmount !== exactInputSingle.amountOutMinimum) {
    throw new Error("signRobinhoodTransaction: swap takeMinAmount must equal amountOutMinimum");
  }

  // settle/take currencies must be consistent with zeroForOne: settle is
  // always the input currency, take is always the output currency.
  const expectedSettleCurrency = exactInputSingle.zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const expectedTakeCurrency = exactInputSingle.zeroForOne ? poolKey.currency1 : poolKey.currency0;
  if (getAddress(settleCurrency) !== getAddress(expectedSettleCurrency)) {
    throw new Error("signRobinhoodTransaction: swap settleCurrency is inconsistent with zeroForOne/poolKey");
  }
  if (getAddress(takeCurrency) !== getAddress(expectedTakeCurrency)) {
    throw new Error("signRobinhoodTransaction: swap takeCurrency is inconsistent with zeroForOne/poolKey");
  }

  const isNativeBuy = getAddress(settleCurrency) === getAddress(NATIVE_CURRENCY);
  const isNativeSell = getAddress(takeCurrency) === getAddress(NATIVE_CURRENCY);
  if (isNativeBuy === isNativeSell) {
    // Guaranteed unreachable given the exactly-one-native check above,
    // but checked explicitly rather than assumed.
    throw new Error("signRobinhoodTransaction: swap direction is ambiguous (settle/take native mismatch)");
  }
  if (isNativeBuy) {
    if (unsignedTransaction.value !== exactInputSingle.amountIn) {
      throw new Error("signRobinhoodTransaction: native-ETH buy requires tx.value === amountIn");
    }
  } else {
    if (unsignedTransaction.value !== BigInt(0)) {
      throw new Error("signRobinhoodTransaction: token sell requires tx.value === 0");
    }
  }

  assertDeadlineWithinPolicy(deadline, "swap deadline");
}

/** Full semantic validation of an erc20_approval-intent transaction:
 * must decode to exactly `approve(spender, amount)` with spender ===
 * Permit2 and a positive amount. `transfer`/`transferFrom`/any other
 * selector is rejected by `decodeFunctionData` itself (ERC20_ABI here
 * contains no such function to match against). */
function validateErc20ApprovalCalldata(data: Hex, config: RobinhoodExecutionConfig): void {
  let decoded: { functionName: string; args: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: ERC20_ABI, data });
  } catch (error) {
    throw new Error(
      `signRobinhoodTransaction: erc20_approval calldata does not decode as a known ERC20_ABI function: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (decoded.functionName !== "approve") {
    throw new Error(`signRobinhoodTransaction: erc20_approval calldata decoded to unexpected function "${decoded.functionName}"`);
  }
  const [spender, amount] = decoded.args as [Address, bigint];
  if (getAddress(spender) !== getAddress(config.permit2)) {
    throw new Error(`signRobinhoodTransaction: erc20_approval spender (${spender}) must be Permit2 (${config.permit2})`);
  }
  if (amount <= BigInt(0)) {
    throw new Error("signRobinhoodTransaction: erc20_approval amount must be positive");
  }
}

/** Full semantic validation of a permit2_authorization-intent
 * transaction: must decode to exactly
 * `approve(token, spender, amount, expiration)` with token === the
 * caller-supplied `approvalToken`, spender === UniversalRouter, a
 * positive amount, and an expiration within PR08's bounded-deadline
 * policy. Any other Permit2 method is rejected by `decodeFunctionData`
 * itself. */
function validatePermit2AuthorizationCalldata(
  data: Hex,
  config: RobinhoodExecutionConfig,
  expectedToken: Address
): void {
  let decoded: { functionName: string; args: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: PERMIT2_ABI, data });
  } catch (error) {
    throw new Error(
      `signRobinhoodTransaction: permit2_authorization calldata does not decode as a known PERMIT2_ABI function: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (decoded.functionName !== "approve") {
    throw new Error(`signRobinhoodTransaction: permit2_authorization calldata decoded to unexpected function "${decoded.functionName}"`);
  }
  const [token, spender, amount, expiration] = decoded.args as [Address, Address, bigint, number];
  if (getAddress(token) !== getAddress(expectedToken)) {
    throw new Error(`signRobinhoodTransaction: permit2_authorization token (${token}) does not match expected (${expectedToken})`);
  }
  if (getAddress(spender) !== getAddress(config.universalRouter)) {
    throw new Error(`signRobinhoodTransaction: permit2_authorization spender (${spender}) must be UniversalRouter (${config.universalRouter})`);
  }
  if (amount <= BigInt(0)) {
    throw new Error("signRobinhoodTransaction: permit2_authorization amount must be positive");
  }
  assertDeadlineWithinPolicy(BigInt(expiration), "permit2_authorization expiration");
}

/**
 * Resolves the intent-scoped allowed `to` target — a necessary but NOT
 * sufficient check on its own; every intent below also validates full
 * calldata semantics via validate*Calldata.
 */
function expectedTargetForIntent(
  intent: SigningIntent,
  config: RobinhoodExecutionConfig,
  approvalToken?: Address
): Address {
  switch (intent) {
    case "swap":
      return config.universalRouter;
    case "permit2_authorization":
      return config.permit2;
    case "erc20_approval":
      if (!approvalToken) {
        throw new Error('signRobinhoodTransaction: intent "erc20_approval" requires approvalToken');
      }
      return approvalToken;
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
 *   - unsignedTransaction.to not the intent-scoped expected target
 *   - unsignedTransaction.value negative
 *   - unsignedTransaction.data empty/"0x"
 *   - FULL calldata semantics not matching the intent exactly (see
 *     validateSwapCalldata / validateErc20ApprovalCalldata /
 *     validatePermit2AuthorizationCalldata)
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

  const expectedTarget = expectedTargetForIntent(input.intent, config, input.approvalToken);
  const to = getAddress(input.unsignedTransaction.to);
  if (to !== getAddress(expectedTarget)) {
    throw new Error(
      `signRobinhoodTransaction: unsignedTransaction.to (${to}) is not the expected target for intent ` +
        `"${input.intent}" (expected: ${expectedTarget})`
    );
  }

  if (input.unsignedTransaction.value < BigInt(0)) {
    throw new Error("signRobinhoodTransaction: unsignedTransaction.value must be non-negative");
  }
  if (!input.unsignedTransaction.data || input.unsignedTransaction.data === "0x") {
    throw new Error("signRobinhoodTransaction: unsignedTransaction.data must be present (non-empty calldata)");
  }

  // Target matched — now validate the FULL calldata semantics for this
  // intent. A matching target with the wrong/malformed calldata is
  // refused just as hard as a mismatched target.
  switch (input.intent) {
    case "swap":
      validateSwapCalldata(input.unsignedTransaction.data, input.unsignedTransaction);
      break;
    case "erc20_approval":
      validateErc20ApprovalCalldata(input.unsignedTransaction.data, config);
      break;
    case "permit2_authorization": {
      // input.approvalToken's presence was already required by
      // expectedTargetForIntent for erc20_approval; permit2_authorization
      // additionally requires it here, as the expected `token` argument
      // inside the decoded Permit2 approve() call (distinct from `to`,
      // which is Permit2 itself for this intent).
      if (!input.approvalToken) {
        throw new Error('signRobinhoodTransaction: intent "permit2_authorization" requires approvalToken (the expected token argument)');
      }
      validatePermit2AuthorizationCalldata(input.unsignedTransaction.data, config, input.approvalToken);
      break;
    }
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
 * key material — target AND full calldata semantics), then the
 * execution-config/active-network guard
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
