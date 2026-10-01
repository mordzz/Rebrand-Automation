/**
 * Agent-wallet L1 signature for Lighter API-key registration - PR12.
 *
 * The ONLY place Noah's autonomous EVM agent key signs an EIP-191 message.
 * It is deliberately not a generic personal_sign: the message must be the
 * official Lighter ChangePubKey message for a fully verified registration
 * intent. Verification (verifyPreparedChangePubKey) runs BEFORE the agent
 * key is loaded; the key never leaves loadRobinhoodAgentAccount's boundary
 * and is never passed to the Lighter WASM signer.
 */
import { getAddress, recoverMessageAddress } from "viem";

import { loadRobinhoodAgentAccount, type AgentWalletBotRow } from "@/lib/chain/robinhood-agent-wallet";
import { verifyPreparedChangePubKey, type ApiKeyRegistrationIntent } from "@/lib/lighter/registration";
import type { PreparedChangePubKey } from "@/lib/lighter/signer-adapter";

export async function signLighterApiKeyRegistration(
  bot: AgentWalletBotRow,
  intent: ApiKeyRegistrationIntent,
  prepared: PreparedChangePubKey,
  deps: { loadAccount?: typeof loadRobinhoodAgentAccount } = {},
): Promise<`0x${string}`> {
  if (!bot.agentPublicKey || getAddress(bot.agentPublicKey) !== getAddress(intent.l1Owner)) {
    throw new Error("Lighter registration refused: intent L1 owner is not this bot's agent wallet");
  }
  // Independent semantic check first - no key material touched yet.
  verifyPreparedChangePubKey(prepared, intent);

  const { account } = await (deps.loadAccount ?? loadRobinhoodAgentAccount)(bot);
  if (getAddress(account.address) !== getAddress(intent.l1Owner)) {
    throw new Error("Lighter registration refused: loaded agent account does not match the L1 owner");
  }
  const signature = await account.signMessage({ message: prepared.messageToSign });
  const recovered = await recoverMessageAddress({ message: prepared.messageToSign, signature });
  if (getAddress(recovered) !== getAddress(intent.l1Owner)) {
    throw new Error("Lighter registration refused: signature does not recover to the agent wallet");
  }
  return signature;
}
