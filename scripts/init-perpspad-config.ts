/**
 * One-time on-chain setup after deploying the Perpspad program.
 *
 * Creates the singleton `Config` PDA with the 50/25/25 fee split. Until
 * this runs, `register_token` cannot succeed — it reads `config.paused`
 * and increments `config.token_count`, so the account has to exist.
 *
 * The signer becomes the protocol admin (the only key that can change
 * the fee split or hit the on-chain pause switch), so run this with the
 * wallet you intend to keep as admin:
 *
 *   npm run init:perpspad
 *
 * Safe to re-run: if the config already exists the instruction fails on
 * Anchor's `init` constraint and this reports that rather than
 * pretending it did something.
 */
import {
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { fetchMaybeConfig } from "@/lib/perps/generated/accounts/config";
import { getInitializeConfigInstructionAsync } from "@/lib/perps/generated/instructions/initializeConfig";
import { findConfigPda } from "@/lib/perps/generated/pdas/config";
import { PERPSPAD_CLUSTER, PERPSPAD_RPC_URL } from "@/lib/perps/program";
import { sendAndConfirmOverHttp } from "@/lib/solana/confirm";

const KEYPAIR_PATH =
  process.env.PERPSPAD_ADMIN_KEYPAIR ??
  join(homedir(), ".config", "solana", "id.json");

/** Matches DEFAULT_FEE_SPLIT in lib/perps/perpspad-types.ts. Once this
 * account exists it, not the DB row, is the source of truth. */
const COLLATERAL_BPS = 5000;
const TOKEN_BURN_BPS = 2500;
const GOV_BURN_BPS = 2500;

async function main(): Promise<void> {
  const secret = new Uint8Array(
    JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")) as number[]
  );
  const admin = await createKeyPairSignerFromBytes(secret);
  const rpc = createSolanaRpc(PERPSPAD_RPC_URL);

  console.log(`cluster : ${PERPSPAD_CLUSTER}`);
  console.log(`rpc     : ${PERPSPAD_RPC_URL}`);
  console.log(`admin   : ${admin.address}`);

  const [configPda] = await findConfigPda();
  console.log(`config  : ${configPda}`);

  const existing = await fetchMaybeConfig(rpc, configPda);
  if (existing.exists) {
    console.log("\nConfig already initialized:");
    console.log(`  admin       ${existing.data.admin}`);
    console.log(
      `  fee split   ${existing.data.feeSplitCollateralBps / 100}% / ` +
        `${existing.data.feeSplitTokenBurnBps / 100}% / ` +
        `${existing.data.feeSplitGovBurnBps / 100}%`
    );
    console.log(`  paused      ${existing.data.paused}`);
    console.log(`  tokens      ${existing.data.tokenCount}`);
    return;
  }

  const instruction = await getInitializeConfigInstructionAsync({
    admin,
    feeSplitCollateralBps: COLLATERAL_BPS,
    feeSplitTokenBurnBps: TOKEN_BURN_BPS,
    feeSplitGovBurnBps: GOV_BURN_BPS,
    // No governance token exists yet; the third fee leg is configured
    // but has nothing to buy back until $PERPSPAD is minted.
    perpspadMint: address("11111111111111111111111111111111"),
  });

  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(admin, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstruction(instruction, m)
  );
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);

  const signature = await sendAndConfirmOverHttp(rpc, signed);
  console.log(`\nConfig initialized. Signature: ${signature}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
