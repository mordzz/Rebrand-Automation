"use client";

/**
 * Builds the `register_token` transaction in the browser.
 *
 * Two signatures are required and they come from different places:
 *
 *  - the **mint** is a fresh keypair generated here, held only long
 *    enough to sign this one transaction. It never leaves the tab and is
 *    never persisted — after registration the mint's authority is the
 *    program's PDA, so the keypair has no further power and nothing is
 *    lost by discarding it.
 *  - the **creator** is the user's Privy wallet, which we cannot sign
 *    with directly. It's represented by a *noop signer*: the account is
 *    marked as a required signer in the compiled message, but no
 *    signature is produced locally. Privy fills that slot when it signs
 *    and broadcasts.
 *
 * So this returns a partially-signed transaction — valid bytes, one
 * signature still missing — which is exactly what a wallet expects to be
 * handed.
 */
import {
  appendTransactionMessageInstruction,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  address,
  createSolanaRpc,
  type Address,
} from "@solana/kit";

import { getRegisterTokenInstructionAsync } from "@/lib/perps/generated/instructions/registerToken";
import { Direction } from "@/lib/perps/generated/types/direction";
import { PERPSPAD_RPC_URL } from "@/lib/perps/program";

export type BuildLaunchTxParams = {
  creatorWallet: string;
  name: string;
  symbol: string;
  underlyingMarketIndex: number;
  direction: "LONG" | "SHORT";
  targetLeverage: number;
};

export type BuiltLaunchTx = {
  /** Wire bytes for the wallet to countersign and broadcast. */
  transactionBytes: Uint8Array;
  /** The new token's mint address — the only thing the server needs,
   * since it reads everything else back off the chain. */
  mint: Address;
};

export async function buildRegisterTokenTransaction(
  params: BuildLaunchTxParams
): Promise<BuiltLaunchTx> {
  const rpc = createSolanaRpc(PERPSPAD_RPC_URL);

  const mintSigner = await generateKeyPairSigner();
  const creatorSigner = createNoopSigner(address(params.creatorWallet));

  const instruction = await getRegisterTokenInstructionAsync({
    creator: creatorSigner,
    mint: mintSigner,
    name: params.name,
    symbol: params.symbol,
    underlyingMarketIndex: params.underlyingMarketIndex,
    direction: params.direction === "LONG" ? Direction.Long : Direction.Short,
    targetLeverage: params.targetLeverage,
  });

  const { value: blockhash } = await rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(creatorSigner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstruction(instruction, m)
  );

  // `partiallySign` rather than `sign`: the creator slot is intentionally
  // left empty for the wallet. `signTransactionMessageWithSigners` would
  // throw here because it requires every signer to actually sign.
  const partiallySigned = await partiallySignTransactionMessageWithSigners(message);

  const wireBase64 = getBase64EncodedWireTransaction(partiallySigned);
  const transactionBytes = new Uint8Array(
    getBase64Encoder().encode(wireBase64)
  );

  return { transactionBytes, mint: mintSigner.address };
}
