/**
 * Lighter realtime account stream - PR12.
 *
 * Official protocol (lighter-python ws_client.py, live-verified on the
 * Robinhood testnet): connect to `wss://<api host>/stream`, send
 * `{"type":"subscribe","channel":"account_all/<accountIndex>"}`, receive
 * `subscribed/account_all` (snapshot) then `update/account_all` messages
 * carrying the account's assets, positions and orders.
 *
 * Read-only. Reconnects with backoff; never sends anything but subscribe.
 */
import { getLighterConfig, type LighterConfig } from "@/lib/lighter/config";

export type AccountStreamMessage = { kind: "snapshot" | "update"; accountIndex: number; payload: Record<string, unknown> };

export function streamUrl(config: LighterConfig): string {
  return `${config.apiOrigin.replace(/^https:/, "wss:")}/stream`;
}

/** Pure parser for one official stream frame; null if not an account frame. */
export function parseAccountFrame(raw: string, accountIndex: number): AccountStreamMessage | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const kind = m.type === "subscribed/account_all" ? "snapshot" : m.type === "update/account_all" ? "update" : null;
  if (!kind) return null;
  const channel = typeof m.channel === "string" ? m.channel : "";
  const channelAccount = Number(channel.split(/[:/]/)[1]);
  const account = Number(m.account ?? channelAccount);
  if (account !== accountIndex) return null;
  return { kind, accountIndex, payload: m };
}

export type AccountStream = { close(): void };

export function subscribeAccount(
  accountIndex: number,
  onMessage: (m: AccountStreamMessage) => void,
  opts: { config?: LighterConfig; onError?: (e: unknown) => void; WebSocketImpl?: typeof WebSocket } = {},
): AccountStream {
  if (!Number.isSafeInteger(accountIndex) || accountIndex < 0) throw new Error("accountIndex must be a non-negative integer");
  const WS = opts.WebSocketImpl ?? globalThis.WebSocket;
  const url = streamUrl(opts.config ?? getLighterConfig());
  let closed = false;
  let backoff = 1_000;
  let ws: WebSocket | null = null;

  const connect = () => {
    if (closed) return;
    ws = new WS(url);
    ws.onopen = () => {
      backoff = 1_000;
      ws?.send(JSON.stringify({ type: "subscribe", channel: `account_all/${accountIndex}` }));
    };
    ws.onmessage = (e) => {
      const msg = parseAccountFrame(String(e.data), accountIndex);
      if (msg) onMessage(msg);
    };
    ws.onerror = (e) => opts.onError?.(e);
    ws.onclose = () => {
      if (closed) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    };
  };
  connect();
  return {
    close() {
      closed = true;
      ws?.close();
    },
  };
}
