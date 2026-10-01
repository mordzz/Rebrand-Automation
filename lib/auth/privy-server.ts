/**
 * Privy server-side authentication + EVM owner-wallet ownership — PR09C.
 *
 * Server-only module (holds PRIVY_APP_SECRET); never import from a client
 * component.
 *
 * Replaces the old "client-asserted wallet" trust model for the routes that
 * mint an autonomous Robinhood agent wallet. The flow is:
 *
 *   browser: Privy `getAccessToken()` → `Authorization: Bearer <token>`
 *   server:  official @privy-io/node
 *            → verify the access token (signature, audience, expiry)
 *            → resolve the AUTHORITATIVE Privy user by the token's subject
 *            → require the claimed owner wallet to be one of that user's
 *              linked EVM (`chain_type: "ethereum"`) wallet accounts
 *            → only then may the caller proceed (e.g. generate a key)
 *
 * Status codes:
 *   401 — missing / malformed / invalid / expired access token
 *   403 — valid Privy user, but the claimed EVM wallet is not linked to them
 *   400 — claimed wallet is not an EVM address
 *   503 — Privy server auth not configured, or the user lookup failed
 *         (fail closed: no key is ever generated without a positive check)
 *
 * The owner wallet only identifies who owns a bot; it is never the wallet
 * the agent trades from (see lib/chain/robinhood-agent-wallet.ts).
 */
import { PrivyClient } from "@privy-io/node";
import { NextResponse } from "next/server";
import { getAddress, isAddress, type Address } from "viem";

/** The two Privy calls this module needs — injectable so the ownership
 * logic is testable offline without real Privy credentials. */
export type PrivyAuthBackend = {
  /** Throws if the token is invalid/expired/for another app. */
  verifyAccessToken(token: string): Promise<{ user_id: string }>;
  /** Authoritative user record, fetched from Privy — never from the token
   * or the request body. */
  getUserLinkedAccounts(userId: string): Promise<ReadonlyArray<LinkedAccountLike>>;
};

/** Only the fields ownership checks read from a Privy linked account. */
export type LinkedAccountLike = {
  type: string;
  chain_type?: string;
  address?: string;
};

export type EvmOwnerAuthResult =
  | { ok: true; privyUserId: string; ownerWallet: Address }
  | { ok: false; status: 400 | 401 | 403 | 503; error: string };

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/** Extracts a JWT-shaped bearer token, or null if missing/malformed. */
export function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * True only if `wallet` is one of the user's linked EVM wallet accounts.
 * Smart wallets and non-EVM (e.g. Solana) accounts never count: the owner
 * identity is the EVM wallet the user actually logged in with / linked.
 */
export function isLinkedEvmWallet(
  accounts: ReadonlyArray<LinkedAccountLike>,
  wallet: Address,
): boolean {
  const target = getAddress(wallet);
  return accounts.some(
    (a) =>
      a.type === "wallet" &&
      a.chain_type === "ethereum" &&
      typeof a.address === "string" &&
      isAddress(a.address) &&
      getAddress(a.address) === target,
  );
}

/** Core check, with the Privy backend injected. */
export async function authenticateEvmOwnerWith(
  backend: PrivyAuthBackend | null,
  authorizationHeader: string | null,
  claimedWallet: string,
): Promise<EvmOwnerAuthResult> {
  if (!backend) {
    return { ok: false, status: 503, error: "Server authentication is not configured" };
  }

  const token = parseBearerToken(authorizationHeader);
  if (!token) {
    return { ok: false, status: 401, error: "Missing or malformed access token" };
  }

  let userId: string;
  try {
    ({ user_id: userId } = await backend.verifyAccessToken(token));
  } catch {
    // Invalid signature, wrong app, expired, or unverifiable — all 401.
    // The token itself is never logged.
    return { ok: false, status: 401, error: "Invalid or expired access token" };
  }
  if (!userId) {
    return { ok: false, status: 401, error: "Invalid or expired access token" };
  }

  if (!isAddress(claimedWallet, { strict: false })) {
    return { ok: false, status: 400, error: "An EVM owner wallet (0x…) is required" };
  }
  const ownerWallet = getAddress(claimedWallet);

  let accounts: ReadonlyArray<LinkedAccountLike>;
  try {
    accounts = await backend.getUserLinkedAccounts(userId);
  } catch {
    return { ok: false, status: 503, error: "Could not resolve the authenticated user" };
  }

  if (!isLinkedEvmWallet(accounts, ownerWallet)) {
    return { ok: false, status: 403, error: "Wallet is not linked to the authenticated user" };
  }

  return { ok: true, privyUserId: userId, ownerWallet };
}

let cachedBackend: PrivyAuthBackend | null | undefined;

/** Official @privy-io/node backend, or null if not configured. */
export function getPrivyAuthBackend(): PrivyAuthBackend | null {
  if (cachedBackend !== undefined) return cachedBackend;

  const appId = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    cachedBackend = null;
    return cachedBackend;
  }

  const client = new PrivyClient({
    appId,
    appSecret,
    // Optional: pins the dashboard verification key instead of fetching JWKS.
    jwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY || undefined,
  });

  cachedBackend = {
    verifyAccessToken: (token) => client.utils().auth().verifyAccessToken(token),
    // PR17 review (docs.privy.io "Querying users" / "Get user by ID"):
    // users()._get(userId) is Privy's documented by-ID lookup. Privy also
    // offers identity-token parsing (users().get({ id_token })) to skip the
    // API call, but the SDK notes that user "may be incomplete due to the
    // size constraints of the identity token" — for an ownership check we
    // want the authoritative, fresh linked-account list, so we keep _get.
    getUserLinkedAccounts: async (userId) => (await client.users()._get(userId)).linked_accounts,
  };
  return cachedBackend;
}

/** Authenticates a route request against the claimed EVM owner wallet. */
export function authenticateEvmOwner(
  request: Request,
  claimedWallet: string,
): Promise<EvmOwnerAuthResult> {
  return authenticateEvmOwnerWith(
    getPrivyAuthBackend(),
    request.headers.get("authorization"),
    claimedWallet,
  );
}

/** JSON error response for a failed auth result. */
export function authErrorResponse(result: Extract<EvmOwnerAuthResult, { ok: false }>) {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

/* ── House administration (PR17) ──────────────────────────────────────────
 * House-level state (the shared sniper_config, the house on/off switch,
 * lesson application, manual trade entry) belongs to the operator, not to
 * any one bot owner. Authorized only for a verified Privy user one of whose
 * LINKED EVM wallets is in the server-only HOUSE_ADMIN_WALLETS allowlist
 * (comma-separated 0x addresses). Unset/empty allowlist = no one (fail
 * closed). No client-supplied wallet is trusted. */

export type HouseAdminAuthResult =
  | { ok: true; privyUserId: string; adminWallet: Address }
  | { ok: false; status: 401 | 403 | 503; error: string };

export function houseAdminWallets(raw: string | undefined = process.env.HOUSE_ADMIN_WALLETS): Set<Address> {
  const out = new Set<Address>();
  for (const part of (raw ?? "").split(",")) {
    const w = part.trim();
    if (w && isAddress(w, { strict: false })) out.add(getAddress(w));
  }
  return out;
}

export async function authenticateHouseAdminWith(
  backend: PrivyAuthBackend | null,
  authorizationHeader: string | null,
  admins: Set<Address>,
): Promise<HouseAdminAuthResult> {
  if (!backend) return { ok: false, status: 503, error: "Server authentication is not configured" };
  const token = parseBearerToken(authorizationHeader);
  if (!token) return { ok: false, status: 401, error: "Missing or malformed access token" };
  let userId: string;
  try {
    ({ user_id: userId } = await backend.verifyAccessToken(token));
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired access token" };
  }
  if (!userId) return { ok: false, status: 401, error: "Invalid or expired access token" };
  if (admins.size === 0) {
    return { ok: false, status: 403, error: "House administration is not configured on this server" };
  }
  let accounts: ReadonlyArray<LinkedAccountLike>;
  try {
    accounts = await backend.getUserLinkedAccounts(userId);
  } catch {
    return { ok: false, status: 503, error: "Could not resolve the authenticated user" };
  }
  for (const admin of admins) {
    if (isLinkedEvmWallet(accounts, admin)) return { ok: true, privyUserId: userId, adminWallet: admin };
  }
  return { ok: false, status: 403, error: "Not a house administrator" };
}

export function authenticateHouseAdmin(request: Request): Promise<HouseAdminAuthResult> {
  return authenticateHouseAdminWith(getPrivyAuthBackend(), request.headers.get("authorization"), houseAdminWallets());
}

export function houseAdminErrorResponse(result: Extract<HouseAdminAuthResult, { ok: false }>) {
  return NextResponse.json({ error: result.error }, { status: result.status });
}
