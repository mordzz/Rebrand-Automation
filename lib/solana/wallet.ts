// Server-only module: PRIVATE_KEY_SOLANA_WALLET is read here and never
// crosses to the client. Only imported by the /api/wallet route handler
// (and, for signing, by lib/eliza/actions/solana-transfer.ts).
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  assertIsTransactionWithinSizeLimit,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase58Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  signTransactionMessageWithSigners,
  type Instruction,
} from "@solana/kit";

const LAMPORTS_PER_SOL = 1_000_000_000;

const RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const RPC_WS_URL = RPC_URL.replace(/^http/, "ws");

const SYSTEM_PROGRAM_ADDRESS = address(
  "11111111111111111111111111111111"
);

/** Shared RPC client for read-only queries elsewhere (e.g. lib/sniper/*). */
export function getRpc() {
  return createSolanaRpc(RPC_URL);
}

/**
 * Accepts the two formats wallets export:
 *  - base58 string (Phantom / Solflare "export private key")
 *  - JSON byte array (Solana CLI keypair file contents)
 * Returns the 64-byte secret key.
 */
export function decodeSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }
  return new Uint8Array(getBase58Encoder().encode(trimmed));
}

/**
 * Raw System Program "Transfer" instruction: u32 discriminant (2) + u64
 * lamports, both little-endian. This layout is part of the base Solana
 * protocol and has never changed; encoded by hand rather than pulling in
 * @solana-program/system, whose latest release peer-depends on
 * @solana/kit@^6 and conflicts with the ^7 already used in this project.
 */
function encodeTransferInstructionData(lamports: bigint): Uint8Array {
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  new DataView(data.buffer).setBigUint64(4, lamports, true);
  return data;
}

/**
 * Derive the wallet's public address from PRIVATE_KEY_SOLANA_WALLET.
 * The secret key never leaves this server module.
 */
export async function getWalletAddress(): Promise<string | null> {
  const raw = process.env.PRIVATE_KEY_SOLANA_WALLET;
  if (!raw) return null;
  const signer = await createKeyPairSignerFromBytes(decodeSecretKey(raw));
  return signer.address;
}

export type WalletSnapshot = {
  connected: boolean;
  address?: string;
  balanceSol?: number;
  balanceUsd?: number;
  solPriceUsd?: number;
  rpc?: string;
  error?: string;
};

async function fetchSolPrice(): Promise<number | undefined> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { next: { revalidate: 60 } }
    );
    const json = await res.json();
    const price = json?.solana?.usd;
    return typeof price === "number" ? price : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read-only snapshot of the automation wallet: address + SOL balance + USD.
 * No signing, no transactions — safe to call on every dashboard load.
 */
export async function getWalletSnapshot(): Promise<WalletSnapshot> {
  const addr = await getWalletAddress().catch(() => null);
  if (!addr) return { connected: false };

  try {
    const rpc = createSolanaRpc(RPC_URL);
    const [{ value: lamports }, solPriceUsd] = await Promise.all([
      rpc.getBalance(address(addr)).send(),
      fetchSolPrice(),
    ]);

    const balanceSol = Number(lamports) / LAMPORTS_PER_SOL;
    return {
      connected: true,
      address: addr,
      balanceSol,
      balanceUsd: solPriceUsd ? balanceSol * solPriceUsd : undefined,
      solPriceUsd,
      rpc: new URL(RPC_URL).host,
    };
  } catch (error) {
    // Address derived, but the RPC read failed (rate limit / network).
    return {
      connected: true,
      address: addr,
      error: error instanceof Error ? error.message : "RPC error",
    };
  }
}

export type AddressBalanceSnapshot = {
  address: string;
  balanceSol?: number;
  balanceUsd?: number;
  rpc?: string;
  error?: string;
};

/**
 * Read-only balance lookup for an arbitrary public address (e.g. a wallet
 * connected client-side via Privy) — no private key involved, so this is
 * safe to expose through an API route unlike getWalletSnapshot above.
 */
export async function getAddressBalance(
  addr: string
): Promise<AddressBalanceSnapshot> {
  try {
    const rpc = createSolanaRpc(RPC_URL);
    const [{ value: lamports }, solPriceUsd] = await Promise.all([
      rpc.getBalance(address(addr)).send(),
      fetchSolPrice(),
    ]);

    const balanceSol = Number(lamports) / LAMPORTS_PER_SOL;
    return {
      address: addr,
      balanceSol,
      balanceUsd: solPriceUsd ? balanceSol * solPriceUsd : undefined,
      rpc: new URL(RPC_URL).host,
    };
  } catch (error) {
    return {
      address: addr,
      error: error instanceof Error ? error.message : "Invalid address or RPC error",
    };
  }
}

export type SolTransferResult = {
  signature: string;
  destination: string;
  amountSol: number;
};

/**
 * Signs and sends a real SOL transfer from the automation wallet. Only
 * called from lib/eliza/actions/solana-transfer.ts, itself only reachable
 * after that action's own ELIZA_ENABLE_TRADING + size-cap + exact-phrase
 * confirmation checks pass — this function performs no authorization
 * checks of its own and trusts its caller.
 */
export async function sendSolTransfer(
  destination: string,
  amountSol: number
): Promise<SolTransferResult> {
  const raw = process.env.PRIVATE_KEY_SOLANA_WALLET;
  if (!raw) throw new Error("PRIVATE_KEY_SOLANA_WALLET not configured");

  const signer = await createKeyPairSignerFromBytes(decodeSecretKey(raw));
  const destinationAddress = address(destination);
  const lamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));

  const instruction: Instruction = {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: signer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: destinationAddress, role: AccountRole.WRITABLE },
    ],
    data: encodeTransferInstructionData(lamports),
  };

  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(instruction, m)
  );

  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  assertIsTransactionWithinSizeLimit(signed);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  await sendAndConfirm(signed, { commitment: "confirmed" });

  return {
    signature: getSignatureFromTransaction(signed),
    destination,
    amountSol,
  };
}

/**
 * Signs and sends a transaction built by a third party (e.g. PumpPortal's
 * Local Transaction API, which returns unsigned wire bytes rather than
 * building via our own TransactionMessage pipeline). Shared signing path
 * for the Sniper's buy/sell — same "the key never leaves this module"
 * property as sendSolTransfer. Performs no authorization/size-limit checks
 * of its own; the caller (lib/sniper/*) is responsible for all risk gating
 * before this is ever invoked.
 */
export async function signAndSendRawTransaction(
  unsignedTxBytes: Uint8Array
): Promise<string> {
  const raw = process.env.PRIVATE_KEY_SOLANA_WALLET;
  if (!raw) throw new Error("PRIVATE_KEY_SOLANA_WALLET not configured");

  const signer = await createKeyPairSignerFromBytes(decodeSecretKey(raw));
  const transaction = getTransactionDecoder().decode(unsignedTxBytes);
  const signed = await signTransaction([signer.keyPair], transaction);
  assertIsTransactionWithBlockhashLifetime(signed);
  assertIsTransactionWithinSizeLimit(signed);

  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  await sendAndConfirm(signed, { commitment: "confirmed" });

  return getSignatureFromTransaction(signed);
}
