/**
 * End-to-end test for the Perpspad Anchor program against a local
 * validator.
 *
 * Run with `npm run test:perpspad`. Requires `anchor build` to have
 * produced target/deploy/perpspad.so and the generated client to be up
 * to date (`npm run gen:perpspad`).
 *
 * Localnet rather than devnet on purpose: this needs to airdrop freely
 * and to start from an empty chain so the singleton `Config` PDA can
 * actually be initialized. It also means the negative cases (paused,
 * bad leverage, non-admin, duplicate mint) can be exercised without
 * burning real devnet SOL or leaving junk accounts behind.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  address,
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";

import { fetchConfig } from "@/lib/perps/generated/accounts/config";
import { fetchPerpToken } from "@/lib/perps/generated/accounts/perpToken";
import { getInitializeConfigInstructionAsync } from "@/lib/perps/generated/instructions/initializeConfig";
import { getRegisterTokenInstructionAsync } from "@/lib/perps/generated/instructions/registerToken";
import { getSetPausedInstructionAsync } from "@/lib/perps/generated/instructions/setPaused";
import { getUpdateFeeSplitInstructionAsync } from "@/lib/perps/generated/instructions/updateFeeSplit";
import { findConfigPda } from "@/lib/perps/generated/pdas/config";
import { Direction } from "@/lib/perps/generated/types/direction";
import { sendAndConfirmOverHttp } from "@/lib/solana/confirm";

const PROGRAM_ID = "CUsgyc49DaWgRcRyLfKjrR5SnCRcDi4CAyuBuU692VQa";
const RPC_URL = "http://127.0.0.1:8899";
const SO_PATH = join(process.cwd(), "target", "deploy", "perpspad.so");
const LAMPORTS_PER_SOL = BigInt("1000000000");
/** 1e9 whole tokens at 6 decimals — must match state.rs's TOTAL_SUPPLY. */
const EXPECTED_SUPPLY = BigInt("1000000000000000");

/** `requestAirdrop` only exists on test clusters, so Kit's generic RPC
 * type doesn't carry it — this script is localnet-only by construction
 * (it spawns the validator itself), so widening here is accurate rather
 * than a papered-over mismatch. */
type Rpc = ReturnType<typeof createSolanaRpc> & {
  requestAirdrop: (
    recipient: Address,
    lamports: bigint
  ) => { send: () => Promise<string> };
};

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function send(
  rpc: Rpc,
  payer: KeyPairSigner,
  instruction: Instruction
): Promise<string> {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstruction(instruction, m)
  );
  const signed = await signTransactionMessageWithSigners(message);
  // Narrows the lifetime union — the message above was built with a
  // blockhash, but the signer's return type still admits durable nonces.
  assertIsTransactionWithBlockhashLifetime(signed);
  return sendAndConfirmOverHttp(rpc, signed);
}

/** Asserts the instruction is rejected. Returns the error text so the
 * caller can check *why* it failed, not merely that it did — a test that
 * passes because of an unrelated error is worse than no test. */
async function expectFailure(
  rpc: Rpc,
  payer: KeyPairSigner,
  instruction: Instruction
): Promise<string> {
  try {
    await send(rpc, payer, instruction);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function airdrop(rpc: Rpc, to: string, sol: number): Promise<void> {
  await rpc.requestAirdrop(address(to), BigInt(sol) * LAMPORTS_PER_SOL).send();
  // Localnet confirms fast, but not instantly.
  for (let i = 0; i < 40; i++) {
    const { value } = await rpc.getBalance(address(to)).send();
    if (value > BigInt(0)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`airdrop to ${to} never landed`);
}

function startValidator(): ChildProcess {
  const proc = spawn(
    "solana-test-validator",
    [
      "--reset",
      "--quiet",
      "--bpf-program",
      PROGRAM_ID,
      SO_PATH,
      "--ledger",
      join(process.cwd(), "test-ledger"),
    ],
    { stdio: "ignore" }
  );
  return proc;
}

async function waitForValidator(rpc: Rpc): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      await rpc.getLatestBlockhash().send();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("validator never became ready");
}

async function main(): Promise<void> {
  if (!existsSync(SO_PATH)) {
    console.error(`No program binary at ${SO_PATH}. Run \`anchor build\` first.`);
    process.exit(1);
  }

  console.log("Starting local validator…");
  const validator = startValidator();
  const rpc = createSolanaRpc(RPC_URL) as Rpc;

  try {
    await waitForValidator(rpc);
    console.log("Validator up.\n");

    const admin = await generateKeyPairSigner();
    const stranger = await generateKeyPairSigner();
    await airdrop(rpc, admin.address, 100);
    await airdrop(rpc, stranger.address, 10);

    // ── initialize_config ──────────────────────────────────────────
    console.log("initialize_config");
    const badSplit = await getInitializeConfigInstructionAsync({
      admin,
      feeSplitCollateralBps: 5000,
      feeSplitTokenBurnBps: 2500,
      feeSplitGovBurnBps: 2000, // sums to 9500, not 10000
      perpspadMint: address("11111111111111111111111111111111"),
    });
    const badSplitErr = await expectFailure(rpc, admin, badSplit);
    check(
      "rejects a fee split that does not sum to 10000 bps",
      badSplitErr !== "",
      "instruction unexpectedly succeeded"
    );

    const initIx = await getInitializeConfigInstructionAsync({
      admin,
      feeSplitCollateralBps: 5000,
      feeSplitTokenBurnBps: 2500,
      feeSplitGovBurnBps: 2500,
      perpspadMint: address("11111111111111111111111111111111"),
    });
    await send(rpc, admin, initIx);

    const [configPda] = await findConfigPda();
    let config = await fetchConfig(rpc, configPda);
    check("config admin recorded", config.data.admin === admin.address);
    check("collateral leg is 5000 bps", config.data.feeSplitCollateralBps === 5000);
    check("token burn leg is 2500 bps", config.data.feeSplitTokenBurnBps === 2500);
    check("gov burn leg is 2500 bps", config.data.feeSplitGovBurnBps === 2500);
    check("starts unpaused", config.data.paused === false);
    check("token count starts at zero", config.data.tokenCount === BigInt(0));

    // ── update_fee_split ───────────────────────────────────────────
    console.log("\nupdate_fee_split");
    const strangerUpdate = await getUpdateFeeSplitInstructionAsync({
      admin: stranger,
      feeSplitCollateralBps: 6000,
      feeSplitTokenBurnBps: 2000,
      feeSplitGovBurnBps: 2000,
    });
    const strangerErr = await expectFailure(rpc, stranger, strangerUpdate);
    check("non-admin cannot change the fee split", strangerErr !== "");

    const badUpdate = await getUpdateFeeSplitInstructionAsync({
      admin,
      feeSplitCollateralBps: 6000,
      feeSplitTokenBurnBps: 2000,
      feeSplitGovBurnBps: 3000, // 11000
    });
    const badUpdateErr = await expectFailure(rpc, admin, badUpdate);
    check("admin still cannot set an invalid split", badUpdateErr !== "");

    const goodUpdate = await getUpdateFeeSplitInstructionAsync({
      admin,
      feeSplitCollateralBps: 6000,
      feeSplitTokenBurnBps: 2000,
      feeSplitGovBurnBps: 2000,
    });
    await send(rpc, admin, goodUpdate);
    config = await fetchConfig(rpc, configPda);
    check("valid split applied", config.data.feeSplitCollateralBps === 6000);

    // put it back so the launched token reflects the real 50/25/25
    await send(
      rpc,
      admin,
      await getUpdateFeeSplitInstructionAsync({
        admin,
        feeSplitCollateralBps: 5000,
        feeSplitTokenBurnBps: 2500,
        feeSplitGovBurnBps: 2500,
      })
    );

    // ── register_token ─────────────────────────────────────────────
    console.log("\nregister_token");
    const creator = await generateKeyPairSigner();
    await airdrop(rpc, creator.address, 10);

    const badLevMint = await generateKeyPairSigner();
    const badLev = await getRegisterTokenInstructionAsync({
      creator,
      mint: badLevMint,
      name: "Too Much Leverage",
      symbol: "TOOMUCH",
      underlyingMarketIndex: 1,
      direction: Direction.Long,
      targetLeverage: 50, // cap is 20
    });
    const badLevErr = await expectFailure(rpc, creator, badLev);
    check("rejects leverage above the 20× cap", badLevErr !== "");

    const mint = await generateKeyPairSigner();
    const registerIx = await getRegisterTokenInstructionAsync({
      creator,
      mint,
      name: "Long Bitcoin",
      symbol: "LONGBTC",
      underlyingMarketIndex: 1,
      direction: Direction.Long,
      targetLeverage: 5,
    });
    const sig = await send(rpc, creator, registerIx);
    console.log(`  launched: ${mint.address} (${sig.slice(0, 16)}…)`);

    const [perpTokenPda] = await (
      await import("@/lib/perps/generated/pdas/perpToken")
    ).findPerpTokenPda({ mint: mint.address });
    const perpToken = await fetchPerpToken(rpc, perpTokenPda);

    check("mint recorded on PerpToken", perpToken.data.mint === mint.address);
    check("creator recorded", perpToken.data.creator === creator.address);
    check("name round-trips", perpToken.data.name === "Long Bitcoin");
    check("symbol round-trips", perpToken.data.symbol === "LONGBTC");
    check("market index recorded", perpToken.data.underlyingMarketIndex === 1);
    check("direction is LONG", perpToken.data.direction === Direction.Long);
    check("target leverage recorded", perpToken.data.targetLeverage === 5);
    check(
      "status is Pending, not Active (no Drift position exists yet)",
      perpToken.data.status === 0
    );
    check(
      "drift authority bump stored",
      typeof perpToken.data.driftAuthorityBump === "number" &&
        perpToken.data.driftAuthorityBump > 0
    );
    check("counters start at zero", perpToken.data.totalFeesCollected === BigInt(0));

    config = await fetchConfig(rpc, configPda);
    check("config token count incremented", config.data.tokenCount === BigInt(1));

    // Real SPL state, not just our own account
    const supply = await rpc.getTokenSupply(mint.address).send();
    check(
      "full supply minted",
      BigInt(supply.value.amount) === EXPECTED_SUPPLY,
      `got ${supply.value.amount}`
    );
    check("mint has 6 decimals", supply.value.decimals === 6);

    const mintInfo = await rpc
      .getAccountInfo(mint.address, { encoding: "jsonParsed" })
      .send();
    const parsed = mintInfo.value?.data as
      | { parsed?: { info?: { mintAuthority?: string } } }
      | undefined;
    check(
      "mint authority is the token's own PerpToken PDA",
      parsed?.parsed?.info?.mintAuthority === perpTokenPda,
      `got ${parsed?.parsed?.info?.mintAuthority}`
    );

    const creatorTokens = await rpc
      .getTokenAccountsByOwner(
        creator.address,
        { mint: mint.address },
        { encoding: "jsonParsed" }
      )
      .send();
    const creatorBalance =
      creatorTokens.value[0]?.account.data.parsed.info.tokenAmount.amount;
    check(
      "creator holds the entire supply",
      BigInt(creatorBalance ?? "0") === EXPECTED_SUPPLY,
      `got ${creatorBalance}`
    );

    // Same mint twice must not be possible — Anchor's `init` should
    // reject it, but a launchpad silently allowing two registries for one
    // mint is severe enough to assert explicitly.
    const duplicate = await getRegisterTokenInstructionAsync({
      creator,
      mint,
      name: "Duplicate",
      symbol: "DUP",
      underlyingMarketIndex: 1,
      direction: Direction.Long,
      targetLeverage: 5,
    });
    const dupErr = await expectFailure(rpc, creator, duplicate);
    check("rejects re-registering the same mint", dupErr !== "");

    // ── set_paused ─────────────────────────────────────────────────
    console.log("\nset_paused");
    const strangerPause = await getSetPausedInstructionAsync({
      admin: stranger,
      paused: true,
    });
    const strangerPauseErr = await expectFailure(rpc, stranger, strangerPause);
    check("non-admin cannot pause", strangerPauseErr !== "");

    await send(rpc, admin, await getSetPausedInstructionAsync({ admin, paused: true }));
    config = await fetchConfig(rpc, configPda);
    check("protocol reports paused", config.data.paused === true);

    const whilePausedMint = await generateKeyPairSigner();
    const whilePaused = await getRegisterTokenInstructionAsync({
      creator,
      mint: whilePausedMint,
      name: "Should Not Launch",
      symbol: "NOPE",
      underlyingMarketIndex: 0,
      direction: Direction.Short,
      targetLeverage: 3,
    });
    const pausedErr = await expectFailure(rpc, creator, whilePaused);
    check("cannot register a token while paused", pausedErr !== "");

    await send(rpc, admin, await getSetPausedInstructionAsync({ admin, paused: false }));

    const afterUnpauseMint = await generateKeyPairSigner();
    await send(
      rpc,
      creator,
      await getRegisterTokenInstructionAsync({
        creator,
        mint: afterUnpauseMint,
        name: "Short Solana",
        symbol: "SHORTSOL",
        underlyingMarketIndex: 0,
        direction: Direction.Short,
        targetLeverage: 3,
      })
    );
    config = await fetchConfig(rpc, configPda);
    check("registration works again after unpause", config.data.tokenCount === BigInt(2));
  } finally {
    validator.kill("SIGTERM");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
