// PumpPortal (https://pumpportal.fun) is a 3rd-party API for pump.fun/Raydium
// launch data + transaction building — no official SDK exists, so this is
// plain WebSocket + fetch. Field names below were confirmed by connecting
// and logging two real events, not guessed from docs.

export type PumpPortalNewTokenEvent = {
  signature: string;
  mint: string;
  traderPublicKey: string;
  txType: string;
  initialBuy: number;
  solAmount: number;
  bondingCurveKey: string;
  vTokensInBondingCurve: number;
  vSolInBondingCurve: number;
  marketCapSol: number;
  name: string;
  symbol: string;
  uri: string;
  pool: string;
};

function isNewTokenEvent(value: unknown): value is PumpPortalNewTokenEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "txType" in value &&
    (value as { txType?: unknown }).txType === "create" &&
    "mint" in value
  );
}

/**
 * Opens wss://pumpportal.fun/api/data and subscribes to new pump.fun token
 * creation events (free, no API key required). Reconnects with exponential
 * backoff on drop — a long-lived daemon can't afford to silently die on a
 * transient network blip. Returns an unsubscribe function.
 */
export function subscribeNewTokenStream(
  onToken: (event: PumpPortalNewTokenEvent) => void,
  onLog?: (message: string) => void
): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectDelayMs = 1000;

  function connect() {
    if (closed) return;
    ws = new WebSocket("wss://pumpportal.fun/api/data");

    ws.addEventListener("open", () => {
      reconnectDelayMs = 1000;
      onLog?.("PumpPortal WS connected, subscribing to new tokens");
      ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
    });

    ws.addEventListener("message", (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (isNewTokenEvent(parsed)) {
        onToken(parsed);
      }
    });

    ws.addEventListener("close", () => {
      if (closed) return;
      onLog?.(`PumpPortal WS closed, reconnecting in ${reconnectDelayMs}ms`);
      setTimeout(connect, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
    });

    ws.addEventListener("error", () => {
      onLog?.("PumpPortal WS error");
    });
  }

  connect();

  return () => {
    closed = true;
    ws?.close();
  };
}

export type PumpPortalTradeParams = {
  publicKey: string;
  action: "buy" | "sell";
  mint: string;
  /** SOL amount (denominatedInSol=true) or token amount/"100%" (false). */
  amount: number | string;
  denominatedInSol: boolean;
  /** Slippage tolerance, percent. */
  slippage: number;
  /** Priority fee in SOL. */
  priorityFee: number;
  pool?: string;
};

/**
 * PumpPortal's "Local Transaction API": POST /api/trade-local returns the
 * raw wire bytes of an unsigned VersionedTransaction that we sign and send
 * ourselves — PumpPortal never sees the wallet key (0.5% fee vs. 1% on their
 * hosted-signing "Lightning" API, which does require handing them a key).
 */
export async function buildTradeLocalTx(
  params: PumpPortalTradeParams
): Promise<Uint8Array> {
  const res = await fetch("https://pumpportal.fun/api/trade-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: params.publicKey,
      action: params.action,
      mint: params.mint,
      amount: params.amount,
      denominatedInSol: params.denominatedInSol ? "true" : "false",
      slippage: params.slippage,
      priorityFee: params.priorityFee,
      pool: params.pool ?? "pump",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PumpPortal trade-local failed: ${res.status} ${text}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
