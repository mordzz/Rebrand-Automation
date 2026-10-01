/**
 * PR10 Robinhood Chain TESTNET canary - the first real broadcast.
 *
 * Proves the full execution path end to end with tiny amounts:
 *
 *   PR08 quote/build → PR09 sign (autonomous agent wallet) → PR10 broadcast
 *   → receipt verification
 *
 * Steps (each broadcast is ledgered by hash BEFORE it is sent):
 *   1. BUY   0.00001 ETH → test token via the audited native-ETH v4 pool
 *   2. REBROADCAST the exact signed BUY again - must be a no-op
 *   3. APPROVE token → Permit2 (exact amount), if needed
 *   4. AUTHORIZE Permit2 → UniversalRouter (exact amount, bounded expiry), if needed
 *   5. SELL  the tokens received back to native ETH
 *
 * TESTNET ONLY (chain 46630): the broadcaster refuses anything else.
 *
 * The canary wallet is generated once and stored ENCRYPTED (AES-256-GCM)
 * with its own test-only key, ROBINHOOD_TESTNET_CANARY_ENCRYPTION_KEY
 * (32 bytes, hex or base64), in data/robinhood-testnet-canary.wallet.json
 * (gitignored). It deliberately does NOT use AGENT_WALLET_ENCRYPTION_KEY,
 * which also enables production agent-wallet creation. Its private key is never printed. If it is unfunded, the
 * script prints the address to fund from the Robinhood testnet faucet and
 * exits with code 2 without sending anything.
 *
 * Run: npm run canary:robinhood-testnet
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import * as crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { bytesToHex, formatEther, getAddress, hexToBytes, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { explorerUrl, ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { getErc20Balance, getNativeBalance, getRobinhoodPublicClient } from "@/lib/chain/rpc";
import type { AgentWalletBotRow } from "@/lib/chain/robinhood-agent-wallet";
import { signRobinhoodTransaction, type SigningIntent } from "@/lib/chain/robinhood-agent-signing";
import {
  broadcastRobinhoodTransaction,
  waitForRobinhoodReceipt,
  type BroadcastRecord,
} from "@/lib/chain/robinhood-broadcast";
import { resolveRobinhoodExecutionConfig } from "@/lib/chain/robinhood-execution-config";
import { interpretMinedReceipt } from "@/lib/chain/robinhood-v4-receipt";
import { NATIVE_CURRENCY, type PoolKey } from "@/lib/chain/robinhood-v4-pool";
import { quoteSwap } from "@/lib/chain/robinhood-v4-quote";
import {
  buildErc20ApprovalTransaction,
  buildNativeBuyTransaction,
  buildNativeSellTransaction,
  buildPermit2AuthorizationTransaction,
  checkErc20AllowanceToPermit2,
  checkPermit2AllowanceToRouter,
  type UnsignedTransaction,
} from "@/lib/chain/robinhood-v4-swap-tx";

/** The pool the PR08 testnet swap audit (git history) verified (testnet
 * dev-test token) - also used by test-robinhood-v4-live.ts. */
const CANARY_POOL: PoolKey = {
  currency0: NATIVE_CURRENCY,
  currency1: "0xf0EA05Cd5FD14189b80616eF36bE2caefd389D4E",
  fee: 20000,
  tickSpacing: 60,
  hooks: NATIVE_CURRENCY,
};
const BUY_AMOUNT_WEI = BigInt(10_000_000_000_000); // 0.00001 ETH
const MIN_BALANCE_WEI = BigInt(200_000_000_000_000); // 0.0002 ETH: canary + gas headroom
const SLIPPAGE_BPS = 500;

const DATA_DIR = join(process.cwd(), "data");
const WALLET_FILE = join(DATA_DIR, "robinhood-testnet-canary.wallet.json");
const LEDGER_FILE = join(DATA_DIR, "robinhood-testnet-canary.ledger.jsonl");

type StoredWallet = { address: Address; secretEnc: string; network: string };

/** Test-only canary key: exactly 32 decoded bytes, hex or base64. Never
 * printed; errors never include the value. */
function canaryKey(): Buffer {
  const raw = process.env.ROBINHOOD_TESTNET_CANARY_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("ROBINHOOD_TESTNET_CANARY_ENCRYPTION_KEY is not set (32 bytes, hex or base64).");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ROBINHOOD_TESTNET_CANARY_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

function encryptCanarySecret(secret: Uint8Array): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", canaryKey(), iv);
  const data = Buffer.concat([cipher.update(secret), cipher.final()]);
  return ["canary1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

function decryptCanarySecret(stored: string): Uint8Array {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "canary1" || !iv || !tag || !data) throw new Error("Canary wallet file is not in the expected format.");
  const d = crypto.createDecipheriv("aes-256-gcm", canaryKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return new Uint8Array(Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]));
  } catch {
    throw new Error("Canary wallet decryption failed (wrong ROBINHOOD_TESTNET_CANARY_ENCRYPTION_KEY?).");
  }
}

/** Signer key loader for the canary only - same fail-closed checks as the
 * production loader (chain, network, stored address == derived address). */
async function loadCanaryAccount(bot: AgentWalletBotRow) {
  if (bot.agentChain !== "robinhood" || bot.agentNetwork !== "testnet" || !bot.agentSecretEnc || !bot.agentPublicKey) {
    throw new Error("Canary wallet row is not a Robinhood testnet wallet.");
  }
  const bytes = decryptCanarySecret(bot.agentSecretEnc);
  if (bytes.length !== 32) throw new Error("Canary key is not 32 bytes.");
  const account = privateKeyToAccount(bytesToHex(bytes));
  if (getAddress(account.address) !== getAddress(bot.agentPublicKey)) {
    throw new Error("Canary derived address does not match the stored address.");
  }
  return { account, address: account.address };
}

function ledger(entry: Record<string, unknown>) {
  appendFileSync(
    LEDGER_FILE,
    JSON.stringify({ at: new Date().toISOString(), ...entry }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n",
  );
}

async function loadOrCreateWallet(): Promise<StoredWallet> {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(WALLET_FILE)) return JSON.parse(readFileSync(WALLET_FILE, "utf8")) as StoredWallet;
  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;
  const stored: StoredWallet = { address, secretEnc: encryptCanarySecret(hexToBytes(pk)), network: "testnet" };
  writeFileSync(WALLET_FILE, JSON.stringify(stored, null, 2), { flag: "wx" });
  console.log(`Generated canary wallet ${address} (encrypted with the canary key in ${WALLET_FILE}).`);
  return stored;
}

async function main() {
  if (ROBINHOOD_NETWORK !== "testnet") throw new Error("Canary runs on Robinhood testnet only.");
  canaryKey(); // validate before touching any wallet file
  const cfg = resolveRobinhoodExecutionConfig("testnet");
  if (!cfg.ok) throw new Error(cfg.reason);
  const config = cfg.config;

  const stored = await loadOrCreateWallet();
  if (stored.network !== "testnet") throw new Error("Stored canary wallet is not a testnet wallet.");
  await loadCanaryAccount({ agentChain: "robinhood", agentNetwork: stored.network, agentPublicKey: stored.address, agentSecretEnc: stored.secretEnc });
  const bot: AgentWalletBotRow = {
    agentChain: "robinhood",
    agentNetwork: stored.network,
    agentPublicKey: stored.address,
    agentSecretEnc: stored.secretEnc,
  };
  const sender = getAddress(stored.address);
  const token = CANARY_POOL.currency1;

  const balance = await getNativeBalance(sender);
  console.log(`Canary wallet ${sender}: ${formatEther(balance)} ETH (testnet)`);
  if (balance < MIN_BALANCE_WEI) {
    console.log(
      `\nBLOCKED: fund ${sender} with at least ${formatEther(MIN_BALANCE_WEI)} testnet ETH ` +
        `from the Robinhood Chain testnet faucet, then re-run. Nothing was sent.\n${explorerUrl("address", sender)}`,
    );
    process.exitCode = 2;
    return;
  }

  const hashes: Array<{ step: string; hash: string; status: string }> = [];

  async function execute(step: string, unsigned: UnsignedTransaction, intent: SigningIntent, approvalToken?: Address) {
    const signed = await signRobinhoodTransaction(
      { bot, unsignedTransaction: unsigned, intent, approvalToken },
      { loadAccount: loadCanaryAccount },
    );
    const input = {
      expectedSender: sender,
      unsignedTransaction: unsigned,
      signed,
      persistBeforeSend: async (rec: BroadcastRecord) => ledger({ step, phase: "pre-send", ...rec }),
    };
    const sent = await broadcastRobinhoodTransaction(input);
    console.log(`${step}: ${sent.hash}${sent.alreadyKnown ? " (already known)" : ""}`);
    const confirmed = await waitForRobinhoodReceipt({ hash: sent.hash, sender, to: getAddress(unsigned.to) });
    ledger({ step, phase: "receipt", hash: sent.hash, status: confirmed.status, block: confirmed.receipt.blockNumber });
    hashes.push({ step, hash: sent.hash, status: confirmed.status });
    if (confirmed.status !== "success") {
      throw new Error(`${step} did not succeed: ${confirmed.status} ${"detail" in confirmed ? confirmed.detail : ""}`);
    }
    return { input, receipt: confirmed.receipt };
  }

  // 1. BUY
  const tokenBefore = await getErc20Balance(token, sender);
  const buyQuote = await quoteSwap({ config, poolKey: CANARY_POOL, side: "buy", amountIn: BUY_AMOUNT_WEI, slippageBps: SLIPPAGE_BPS });
  if (!buyQuote.ok) throw new Error(`buy quote failed: ${buyQuote.reason}`);
  const buy = await execute("buy", buildNativeBuyTransaction(config, buyQuote.quote), "swap");
  const buyView = interpretMinedReceipt(config, buy.receipt);
  if (buyView.status !== "success") throw new Error(`buy receipt interpretation: ${buyView.status}`);
  const received = (await getErc20Balance(token, sender)) - tokenBefore;
  console.log(`  received ${received} token base units (quoted min ${buyQuote.quote.amountOutMinimum})`);
  if (received < buyQuote.quote.amountOutMinimum) throw new Error("buy received less than amountOutMinimum");

  // 2. REBROADCAST the exact same signed BUY - must not create a second tx.
  const nonceBefore = await getRobinhoodPublicClient().getTransactionCount({ address: sender, blockTag: "latest" });
  const again = await broadcastRobinhoodTransaction(buy.input);
  const nonceAfter = await getRobinhoodPublicClient().getTransactionCount({ address: sender, blockTag: "latest" });
  const rebroadcastSafe = again.alreadyKnown && nonceAfter === nonceBefore;
  console.log(`rebroadcast: alreadyKnown=${again.alreadyKnown}, nonce unchanged=${nonceAfter === nonceBefore}`);
  ledger({ step: "rebroadcast", hash: again.hash, alreadyKnown: again.alreadyKnown, nonceBefore, nonceAfter });
  if (!rebroadcastSafe) throw new Error("rebroadcast was not a no-op");

  // 3–4. Exact-amount approvals for the sell.
  if ((await checkErc20AllowanceToPermit2(config, token, sender)) < received) {
    await execute("approve_permit2", buildErc20ApprovalTransaction(config, token, received), "erc20_approval", token);
  }
  const p2 = await checkPermit2AllowanceToRouter(config, token, sender);
  if (p2.amount < received || p2.expiration <= Math.floor(Date.now() / 1000) + 60) {
    await execute("permit2_authorize", buildPermit2AuthorizationTransaction(config, token, received), "permit2_authorization", token);
  }

  // 5. SELL back to native ETH.
  const sellQuote = await quoteSwap({ config, poolKey: CANARY_POOL, side: "sell", amountIn: received, slippageBps: SLIPPAGE_BPS });
  if (!sellQuote.ok) throw new Error(`sell quote failed: ${sellQuote.reason}`);
  await execute("sell", buildNativeSellTransaction(config, sellQuote.quote), "swap");

  console.log("\nCanary complete - testnet transaction hashes:");
  for (const h of hashes) console.log(`  ${h.step.padEnd(18)} ${h.status.padEnd(8)} ${explorerUrl("tx", h.hash)}`);
  console.log(`  rebroadcast        no-op    (same hash ${again.hash}, no new nonce)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
