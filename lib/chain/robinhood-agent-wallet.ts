/**
 * Robinhood Chain (EVM) autonomous agent wallet — PR09.
 *
 * Server-only module. Holds the key material for per-bot EVM trading
 * wallets and must never be imported from a client component — same
 * convention as lib/solana/agent-wallet.ts, which this module sits
 * alongside (not in place of; see that file's doc comment and
 * MIGRATION_MATRIX.md for why legacy Solana bots keep working unchanged).
 *
 * ══════════════════════════════════════════════════════════════════════
 * OWNER WALLET vs AGENT WALLET — never conflate these
 * ══════════════════════════════════════════════════════════════════════
 * The operator's connected Privy/MetaMask wallet (`userBots.walletAddress`)
 * is an OWNER IDENTITY wallet — it identifies who owns a bot and is used
 * for interactive actions. It is never asked for, held, or responsible
 * for unattended daemon trading. The AGENT wallet this module generates
 * is a brand-new, server-side EVM keypair the daemon signs with — nothing
 * here ever derives an agent private key from the owner wallet, and
 * nothing here ever exposes agent key material to a browser.
 *
 * Encryption at rest reuses lib/wallet/secret-encryption.ts's chain-
 * neutral AES-256-GCM implementation (encryptSecret/decryptSecret) — that
 * module has no Solana or EVM assumption in it, so this module
 * deliberately does not reimplement its own encryption.
 */
import { bytesToHex, getAddress, hexToBytes, isAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import {
  decryptSecret,
  encryptSecret,
  isAgentWalletConfigured,
} from "@/lib/wallet/secret-encryption";
import { ROBINHOOD_NATIVE_SYMBOL, ROBINHOOD_NETWORK, type RobinhoodNetwork } from "@/lib/chain/config";

export { isAgentWalletConfigured };

export type GeneratedRobinhoodAgentWallet = {
  address: Address;
  /** Encrypted blob, safe to persist. Never the raw key. */
  secretEnc: string;
  chain: "robinhood";
  network: RobinhoodNetwork;
  nativeSymbol: string;
};

/**
 * Creates a fresh EVM keypair for one deployed agent, using viem's own
 * audited key-generation primitive (`generatePrivateKey`, backed by
 * Node's CSPRNG) — no custom key-generation crypto.
 *
 * Deliberately a brand-new wallet, exactly like the Solana path: the
 * operator's MetaMask keys are never requested, never held, and never at
 * risk here. Only what they choose to deposit into this address is ever
 * exposed. Tagged with the ACTIVE network at generation time
 * (`ROBINHOOD_NETWORK`) — a wallet generated while the process is
 * pointed at testnet is a testnet wallet, recorded as such, never
 * silently reinterpreted for another network later.
 */
export async function generateRobinhoodAgentWallet(): Promise<GeneratedRobinhoodAgentWallet> {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const secretEnc = encryptSecret(hexToBytes(privateKey));

  return {
    address: account.address,
    secretEnc,
    chain: "robinhood",
    network: ROBINHOOD_NETWORK,
    nativeSymbol: ROBINHOOD_NATIVE_SYMBOL,
  };
}

/** Address for a stored EVM wallet, without exposing the key. */
export function robinhoodAgentAddressFromSecret(secretEnc: string): Address {
  const privateKey = evmPrivateKeyFromDecryptedBytes(decryptSecret(secretEnc));
  return privateKeyToAccount(privateKey).address;
}

function evmPrivateKeyFromDecryptedBytes(bytes: Uint8Array): Hex {
  if (bytes.length !== 32) {
    throw new Error(`Decrypted key is ${bytes.length} bytes, expected exactly 32 for an EVM private key`);
  }
  return bytesToHex(bytes);
}

/** Minimal shape this module needs from a `user_bots` row — a `Pick<>`
 * rather than importing the full Drizzle row type, so this module has no
 * dependency on the DB layer beyond field names. */
export type AgentWalletBotRow = {
  agentChain: string | null;
  agentNetwork: string | null;
  agentPublicKey: string | null;
  agentSecretEnc: string | null;
};

export type LoadedRobinhoodAgentAccount = {
  account: PrivateKeyAccount;
  address: Address;
};

/**
 * Decrypts, validates, and derives the signing account for a bot's
 * stored Robinhood agent wallet. Fails closed — never silently
 * regenerates a wallet for an existing bot when something is missing or
 * inconsistent, which would orphan whatever the operator already
 * deposited into the old address.
 *
 * Refuses if:
 *   - the bot's agent wallet isn't tagged "robinhood" (this loader is not
 *     for legacy Solana bots — see lib/solana/agent-wallet.ts for those)
 *   - the bot's recorded agent network isn't the process's ACTIVE
 *     Robinhood network (never mainnet today — mainnet autonomous
 *     signing is disabled entirely, see robinhood-agent-signing.ts)
 *   - no encrypted key is stored
 *   - decryption fails (wrong/rotated encryption key, corrupted blob)
 *   - the decrypted key isn't a valid 32-byte EVM private key
 *   - the address derived from that key doesn't match the address on file
 *     — proof the stored (public) address and the stored (encrypted)
 *     private key actually belong together
 */
export async function loadRobinhoodAgentAccount(
  bot: AgentWalletBotRow
): Promise<LoadedRobinhoodAgentAccount> {
  if (bot.agentChain !== "robinhood") {
    throw new Error(
      `loadRobinhoodAgentAccount: bot's agentChain is "${bot.agentChain}", expected "robinhood" — ` +
        `this bot's agent wallet is not an EVM wallet (see lib/solana/agent-wallet.ts for legacy Solana bots)`
    );
  }
  if (bot.agentNetwork !== ROBINHOOD_NETWORK) {
    throw new Error(
      `loadRobinhoodAgentAccount: bot's agentNetwork is "${bot.agentNetwork}", but the active ` +
        `Robinhood network is "${ROBINHOOD_NETWORK}" — refusing to load a wallet for a different network`
    );
  }
  if (!bot.agentSecretEnc) {
    throw new Error("loadRobinhoodAgentAccount: no encrypted agent key stored for this bot");
  }
  if (!bot.agentPublicKey || !isAddress(bot.agentPublicKey)) {
    throw new Error("loadRobinhoodAgentAccount: stored agent address is missing or not a valid EVM address");
  }

  let decryptedBytes: Uint8Array;
  try {
    decryptedBytes = decryptSecret(bot.agentSecretEnc);
  } catch (error) {
    throw new Error(
      `loadRobinhoodAgentAccount: failed to decrypt stored agent key: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  let privateKey: Hex;
  let account: PrivateKeyAccount;
  try {
    privateKey = evmPrivateKeyFromDecryptedBytes(decryptedBytes);
    account = privateKeyToAccount(privateKey);
  } catch (error) {
    throw new Error(
      `loadRobinhoodAgentAccount: decrypted key is not a valid EVM private key: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (getAddress(account.address) !== getAddress(bot.agentPublicKey)) {
    throw new Error(
      `loadRobinhoodAgentAccount: derived address ${account.address} does not match stored agent address ` +
        `${bot.agentPublicKey} — refusing to sign with a key/address pair that doesn't match`
    );
  }

  return { account, address: account.address };
}
