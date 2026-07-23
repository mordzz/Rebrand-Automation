import type { Action, HandlerCallback } from "@elizaos/core";

import { sendSolTransfer } from "@/lib/solana/wallet";

type PendingTransfer = {
  amountSol: number;
  destination: string;
  phrase: string;
  expiresAt: number;
};

const PENDING_TTL_MS = 120_000;

const g = globalThis as unknown as {
  __elizaPendingTransfers?: Map<string, PendingTransfer>;
};
if (!g.__elizaPendingTransfers) g.__elizaPendingTransfers = new Map();
const pendingTransfers = g.__elizaPendingTransfers;

const TRANSFER_INTENT_RE = /\b(transfer|send|pay)\b/i;
const AMOUNT_RE = /(\d+(?:\.\d+)?)\s*sol\b/i;
// Base58 alphabet (excludes 0, O, I, l), Solana addresses are 32-44 chars.
const ADDRESS_RE = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/;

function confirmPhrase(amountSol: number, destination: string): string {
  return `CONFIRM SEND ${amountSol} SOL TO ${destination}`;
}

/**
 * The only signing path in this system — plugin-solana's own transfer/swap
 * actions are permanently disabled via SOLANA_NO_ACTIONS (see settings.ts).
 * A transfer only ever executes after: ELIZA_ENABLE_TRADING="true", the
 * amount is under ELIZA_MAX_TRADE_SOL, and the user replies with an exact,
 * generated confirmation phrase in a follow-up message — all checked here
 * in plain code, never left to the model's judgment.
 */
export const solanaTransferAction: Action = {
  name: "GATED_SOLANA_TRANSFER",
  description:
    "Transfers SOL from the automation wallet after an explicit, exact-phrase confirmation. Disabled unless the deployment operator has enabled trading.",
  similes: ["SEND_SOL", "TRANSFER_SOL"],
  validate: async (runtime, message) => {
    const text = message.content.text ?? "";
    const pending = pendingTransfers.get(message.roomId);
    const isConfirming = Boolean(pending && text.trim() === pending.phrase);
    const isFreshRequest = TRANSFER_INTENT_RE.test(text) && AMOUNT_RE.test(text);
    const eligible = isConfirming || isFreshRequest;
    console.log(
      `[solana-transfer] validate: eligible=${eligible} isConfirming=${isConfirming} isFreshRequest=${isFreshRequest}`
    );
    return eligible;
  },
  handler: async (runtime, message, _state, _options, callback) => {
    const text = message.content.text ?? "";
    const reply = async (replyText: string, success: boolean) => {
      console.log(`[solana-transfer] handler resolved: success=${success} reply=${JSON.stringify(replyText)}`);
      await (callback as HandlerCallback | undefined)?.({ text: replyText });
      return { success, text: replyText };
    };

    const pending = pendingTransfers.get(message.roomId);
    if (pending) {
      pendingTransfers.delete(message.roomId);
      if (text.trim() !== pending.phrase) {
        return reply(
          "That doesn't match the confirmation phrase — the pending transfer has been cancelled. Ask again to start over.",
          false
        );
      }
      if (Date.now() > pending.expiresAt) {
        return reply(
          "That confirmation arrived too late and has expired. Ask again to start over.",
          false
        );
      }
      try {
        const result = await sendSolTransfer(
          pending.destination,
          pending.amountSol
        );
        return reply(
          `Sent ${result.amountSol} SOL to ${result.destination}. Signature: ${result.signature}`,
          true
        );
      } catch (error) {
        return reply(
          `The transfer failed: ${error instanceof Error ? error.message : "unknown error"}`,
          false
        );
      }
    }

    const amountMatch = text.match(AMOUNT_RE);
    const addressMatch = text.match(ADDRESS_RE);
    if (!amountMatch || !addressMatch) {
      return reply(
        "To send SOL, tell me the amount and the destination address, e.g. \"send 1.5 SOL to <address>\".",
        false
      );
    }
    const amountSol = Number(amountMatch[1]);
    const destination = addressMatch[1];

    if (process.env.ELIZA_ENABLE_TRADING !== "true") {
      return reply(
        "Trading is disabled on this deployment. An operator must set ELIZA_ENABLE_TRADING to allow transfers.",
        false
      );
    }
    const maxTradeSol = Number(process.env.ELIZA_MAX_TRADE_SOL ?? "0");
    if (amountSol > maxTradeSol) {
      return reply(
        `That exceeds the per-transfer cap of ${maxTradeSol} SOL configured on this deployment.`,
        false
      );
    }

    const phrase = confirmPhrase(amountSol, destination);
    pendingTransfers.set(message.roomId, {
      amountSol,
      destination,
      phrase,
      expiresAt: Date.now() + PENDING_TTL_MS,
    });
    return reply(
      `To confirm, reply with exactly: ${phrase}\nThis expires in two minutes.`,
      true
    );
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "send 1 SOL to 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" } },
      {
        name: "Noah",
        content: {
          text: "To confirm, reply with exactly: CONFIRM SEND 1 SOL TO 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        },
      },
    ],
  ],
};
