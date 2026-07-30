/**
 * Validation for an operator-supplied Solana RPC endpoint.
 *
 * This URL is submitted by a user and then called from our server, which
 * makes it a server-side request forgery vector: left unchecked, someone
 * could point it at `http://localhost:…`, at cloud metadata endpoints
 * (169.254.169.254), or at anything else reachable from inside our
 * network and use our server as a proxy to probe it. Everything below
 * exists to close that, not merely to catch typos.
 */

export type RpcValidation =
  | { ok: true; url: string; host: string; latencyMs: number; version: string | null }
  | { ok: false; error: string };

/** Hosts that must never be reachable through a user-supplied URL. */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]") return true;
  // Anything that isn't a public DNS name is suspicious; .internal/.local
  // are the common private-zone suffixes.
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;

  // IPv4 literals: block loopback, link-local (incl. cloud metadata), and
  // the three RFC1918 private ranges.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 0) return true;
    if (a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }

  // IPv6 literals: loopback, unique-local (fc00::/7), link-local (fe80::/10).
  if (host.startsWith("[")) {
    const inner = host.slice(1, -1);
    if (inner === "::1" || inner.startsWith("fc") || inner.startsWith("fd")) return true;
    if (inner.startsWith("fe8") || inner.startsWith("fe9") || inner.startsWith("fea") || inner.startsWith("feb")) {
      return true;
    }
  }

  return false;
}

const PROBE_TIMEOUT_MS = 6000;

/**
 * Checks the endpoint is a public HTTPS URL and actually answers as a
 * Solana RPC, returning the round-trip time so the operator sees a real
 * number rather than a claim. Never throws.
 */
export async function validateRpcUrl(raw: string): Promise<RpcValidation> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Enter an RPC URL." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "That isn't a valid URL." };
  }

  // https only: the URL usually carries an API key, and http would put it
  // on the wire in clear text on every single call.
  if (url.protocol !== "https:") {
    return { ok: false, error: "Use an https:// endpoint." };
  }
  if (isBlockedHost(url.hostname)) {
    return { ok: false, error: "That host isn't allowed." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getVersion" }),
      signal: controller.signal,
      redirect: "error", // a redirect could hop to a blocked host
    });
    const latencyMs = Date.now() - startedAt;

    if (!res.ok) {
      return { ok: false, error: `Endpoint replied ${res.status}.` };
    }
    const json = await res.json().catch(() => null);
    const version = json?.result?.["solana-core"];
    if (typeof version !== "string") {
      return { ok: false, error: "That endpoint didn't answer as a Solana RPC." };
    }

    return { ok: true, url: trimmed, host: url.hostname, latencyMs, version };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "Endpoint timed out." : "Could not reach that endpoint.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Host plus a masked tail, safe to send to a browser. Provider URLs carry
 * the API key in the query or path, so the raw value never leaves the
 * server. */
export function maskRpcUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const key =
      url.searchParams.get("api-key") ??
      url.searchParams.get("apikey") ??
      // Helius-style path keys: /?api-key=… or /<key>
      url.pathname.split("/").filter(Boolean).pop() ??
      "";
    const tail = key.length >= 4 ? key.slice(-4) : "";
    return tail ? `${url.hostname} · ••••${tail}` : url.hostname;
  } catch {
    return "configured";
  }
}
