/**
 * Minimal server-side client for GMGN's OpenAPI (https://openapi.gmgn.ai),
 * scoped deliberately to READ-ONLY endpoints.
 *
 * Auth: read-only routes take a plain `X-APIKEY` header. GMGN's swap and
 * strategy-order routes additionally require an Ed25519 request signature
 * - this client cannot reach them and has no signing code, so no key it
 * holds can move funds. That's the same "structurally incapable" posture
 * scripts/paper-daemon.ts takes toward wallet signing.
 *
 * Credentials come from GMGN_API_KEY. Apply for one at https://gmgn.ai/ai
 * (generate an Ed25519 key pair, submit the public key). Unset means every
 * call resolves to null and callers degrade to a "not connected" state,
 * rather than the page erroring or inventing data.
 */

const BASE_URL = "https://openapi.gmgn.ai";
const TIMEOUT_MS = 8000;

export function isGmgnConfigured(): boolean {
  return Boolean(process.env.GMGN_API_KEY?.trim());
}

/** Discriminated failure kinds a caller might need to react to differently
 * - e.g. "GMGN said nothing new happened" (empty `data`) is not the same
 * situation as "we couldn't reach GMGN at all" or "GMGN rejected our key",
 * and a discovery loop that treats them identically will silently run
 * blind on an outage while logging nothing unusual. `gmgnGet` (below)
 * intentionally collapses all of this to `null` for its existing callers
 * - this richer variant is for callers (e.g. the Robinhood discovery
 * adapter) that need to tell the difference. */
export type GmgnRequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "not_configured" }
  | { ok: false; kind: "network_error"; detail: string }
  | { ok: false; kind: "http_error"; status: number }
  | { ok: false; kind: "api_error"; code: number; msg?: string }
  | { ok: false; kind: "malformed_payload"; detail: string };

/** Same request/auth/timeout mechanics as `gmgnGet`, but returns a result
 * that distinguishes *why* there's no data instead of collapsing every
 * failure to `null`. */
export async function gmgnRequest<T>(
  path: string,
  params: Record<string, string | number>,
  init?: { method?: "GET" | "POST"; body?: unknown }
): Promise<GmgnRequestResult<T>> {
  const apiKey = process.env.GMGN_API_KEY?.trim();
  if (!apiKey) return { ok: false, kind: "not_configured" };

  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const method = init?.method ?? "GET";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "X-APIKEY": apiKey,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      // Next.js caches server-side fetch() by URL+options by default; a
      // call with identical params (e.g. getKolTrades' fixed chain+limit)
      // would otherwise freeze on whatever it first returned - wrong for
      // trade/price data that's stale within seconds. Every caller here
      // already marks its own route `force-dynamic` for the same reason;
      // this is that same intent applied to the fetch itself.
      cache: "no-store",
    });
    if (!res.ok) {
      // Rate limiting (429) is the one failure worth a trace: it looks
      // identical to "no data right now" everywhere upstream of this
      // function otherwise, which cost real time to diagnose once.
      if (res.status === 429) console.error(`[gmgn] 429 on ${path}`);
      return { ok: false, kind: "http_error", status: res.status };
    }

    let json: { code?: number; msg?: string; data?: T };
    try {
      json = await res.json();
    } catch (error) {
      return {
        ok: false,
        kind: "malformed_payload",
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    // GMGN wraps every response as { code, msg, data }; code 0 is success.
    if (json?.code !== 0) {
      return { ok: false, kind: "api_error", code: json?.code ?? -1, msg: json?.msg };
    }
    if (json.data === undefined) {
      return { ok: false, kind: "malformed_payload", detail: "response had no data field" };
    }
    return { ok: true, data: json.data };
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "AbortError"
        ? "request timed out"
        : error instanceof Error
          ? error.message
          : String(error);
    return { ok: false, kind: "network_error", detail };
  } finally {
    clearTimeout(timeout);
  }
}

/** Call a read-only endpoint. Returns the unwrapped `data` payload, or null
 * on any failure (unconfigured, network, non-zero API code) - kept as the
 * simple, backward-compatible surface every existing caller here already
 * uses.
 *
 * Some read endpoints are POST with a JSON body (`/v1/trenches` takes its
 * filters that way) - that is still read-only; the signed-request family
 * this client cannot reach is what actually moves funds. */
export async function gmgnGet<T>(
  path: string,
  params: Record<string, string | number>,
  init?: { method?: "GET" | "POST"; body?: unknown }
): Promise<T | null> {
  const result = await gmgnRequest<T>(path, params, init);
  return result.ok ? result.data : null;
}
