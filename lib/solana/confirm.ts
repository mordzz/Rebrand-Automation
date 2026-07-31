// Server-only. Submits a signed transaction and waits for it over HTTP.
import {
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Commitment,
  type GetBlockHeightApi,
  type GetSignatureStatusesApi,
  type Rpc,
  type SendableTransaction,
  type SendTransactionApi,
  type Signature,
  type Transaction,
  type TransactionWithBlockhashLifetime,
} from "@solana/kit";

/**
 * Send-and-confirm without a websocket subscription.
 *
 * Kit's `sendAndConfirmTransactionFactory` needs an `rpcSubscriptions`
 * client, which means a websocket URL. We only ever have an HTTP one: an
 * operator drops a single endpoint into their bot's settings, and deriving
 * `wss://` from it by string replacement is a guess. It happens to hold for
 * the public endpoint and for Helius; it is wrong for providers that serve
 * websockets from a different host or path, and being wrong is expensive
 * here — kit sends first and confirms second, so a websocket that will not
 * connect produces a transaction that landed on-chain while the caller sees
 * a failure and writes no position row. That is exactly the orphaned
 * position §11.4 exists to prevent.
 *
 * Polling `getSignatureStatuses` uses the same HTTP endpoint the operator
 * already gave us, so any provider works with the one URL they pasted. A
 * swap confirms in a few seconds, so this is typically two or three extra
 * requests.
 */

const POLL_INTERVAL_MS = 1_000;
/** Block height is a slower query than signature status; checking it on
 * every poll doubles the request count for no benefit. */
const HEIGHT_CHECK_EVERY = 5;

/** A transaction that was submitted but whose outcome we could not
 * establish. Carries the signature, because the only safe response is to
 * reconcile against the chain rather than resubmit (§11.2). */
export class TransactionIndeterminate extends Error {
  readonly signature: string;
  constructor(signature: string, detail: string) {
    super(`${detail} (signature ${signature})`);
    this.name = "TransactionIndeterminate";
    this.signature = signature;
  }
}

/** The transaction landed and the runtime rejected it. Terminal: the fee is
 * spent and there is nothing to reconcile. */
export class TransactionFailedOnChain extends Error {
  readonly signature: string;
  constructor(signature: string, detail: string) {
    super(`${detail} (signature ${signature})`);
    this.name = "TransactionFailedOnChain";
    this.signature = signature;
  }
}

/** The same shape kit's own factory asks for, minus the subscriptions
 * client and plus getBlockHeight, which replaces the slot subscription as
 * the way we notice a blockhash has expired. */
type ConfirmRpc = Rpc<
  GetBlockHeightApi & GetSignatureStatusesApi & SendTransactionApi
>;

type ConfirmableTransaction = SendableTransaction &
  Transaction &
  TransactionWithBlockhashLifetime;

function isConfirmedEnough(status: string | null | undefined): boolean {
  return status === "confirmed" || status === "finalized";
}

/**
 * Submits `signedTransaction` and resolves with its signature once the
 * cluster reports it confirmed.
 *
 * Throws `TransactionFailedOnChain` if it landed and reverted, and
 * `TransactionIndeterminate` if its blockhash expired without a status or
 * the endpoint stopped answering. Both carry the signature: once bytes are
 * on the wire, losing the signature is the one outcome that leaves a
 * position nobody can find.
 */
export async function sendAndConfirmOverHttp(
  rpc: ConfirmRpc,
  signedTransaction: ConfirmableTransaction,
  commitment: Commitment = "confirmed"
): Promise<string> {
  // Read off the transaction rather than passed alongside it, so the
  // deadline can never describe a different transaction than the one being
  // sent.
  const { lastValidBlockHeight } = signedTransaction.lifetimeConstraint;

  // Derived before submission: the signature is a property of the signed
  // bytes, so we can always name what we sent even if the send call itself
  // times out after the transaction reached the cluster.
  const signature = getSignatureFromTransaction(signedTransaction);
  const wire = getBase64EncodedWireTransaction(signedTransaction);

  try {
    await rpc
      .sendTransaction(wire, { encoding: "base64", preflightCommitment: commitment })
      .send();
  } catch (error) {
    // A rejected send is clean: preflight refused it and nothing landed.
    // Anything else may or may not have reached the cluster, so it is
    // reported as indeterminate rather than as a plain failure.
    const detail = error instanceof Error ? error.message : "send failed";
    if (/preflight|simulat|insufficient|blockhash not found/i.test(detail)) {
      throw new TransactionFailedOnChain(signature, detail);
    }
    throw new TransactionIndeterminate(signature, detail);
  }

  for (let poll = 0; ; poll++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    let status;
    try {
      const { value } = await rpc.getSignatureStatuses([signature as Signature]).send();
      status = value[0];
    } catch {
      // Transient endpoint trouble. Keep polling; the block-height check
      // below is what eventually ends this loop.
      status = null;
    }

    if (status) {
      if (status.err != null) {
        throw new TransactionFailedOnChain(
          signature,
          `transaction reverted: ${JSON.stringify(status.err)}`
        );
      }
      if (isConfirmedEnough(status.confirmationStatus)) return signature;
    }

    if (poll % HEIGHT_CHECK_EVERY === 0) {
      let height: bigint;
      try {
        height = await rpc.getBlockHeight({ commitment }).send();
      } catch {
        continue;
      }
      if (typeof height === "bigint" && height > lastValidBlockHeight) {
        // Past the blockhash's deadline with no status. It cannot land from
        // here, but we do not assert it never did: §11.2 requires an
        // on-chain reconciliation before anything is retried.
        throw new TransactionIndeterminate(
          signature,
          "blockhash expired before the transaction was confirmed"
        );
      }
    }
  }
}
