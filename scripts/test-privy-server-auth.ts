/**
 * Deterministic tests for PR09C Privy server auth + EVM owner ownership:
 * lib/auth/privy-server.ts, plus static checks on the two routes that can
 * mint an autonomous Robinhood agent wallet.
 *
 * No network calls. Two layers:
 *   1. The ownership core (`authenticateEvmOwnerWith`) with an injected
 *      backend — every 400/401/403/503 path and the success path.
 *   2. The OFFICIAL @privy-io/node `verifyAccessToken` against real ES256
 *      tokens signed with a locally generated key — valid, expired, wrong
 *      app, wrong key, wrong issuer — wired into the same core.
 *
 * Run: npm run test:privy-server-auth
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyAccessToken } from "@privy-io/node";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";

import {
  authenticateEvmOwnerWith,
  authenticateSignedInUserWith,
  isLinkedEvmWallet,
  parseBearerToken,
  type LinkedAccountLike,
  type PrivyAuthBackend,
} from "@/lib/auth/privy-server";

let failures = 0;

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`[FAIL] ${label}\n  expected: ${e}\n  actual:   ${a}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

function assert(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`[FAIL] ${label}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

const OWNER = "0x52908400098527886E0F7030069857D2E4169EE7";
const OTHER = "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
const SOLANA = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const FAKE_JWT = "aaaa.bbbb.cccc";

const LINKED: LinkedAccountLike[] = [
  { type: "email" },
  { type: "wallet", chain_type: "solana", address: SOLANA },
  { type: "smart_wallet", address: OTHER },
  { type: "wallet", chain_type: "ethereum", address: OWNER },
];

/** Backend that records calls, so tests can prove ordering/short-circuits. */
function fakeBackend(opts: {
  verify?: (t: string) => Promise<{ user_id: string }>;
  accounts?: LinkedAccountLike[] | Error;
}) {
  const calls = { verify: 0, lookup: 0 };
  const backend: PrivyAuthBackend = {
    async verifyAccessToken(t) {
      calls.verify++;
      return opts.verify ? opts.verify(t) : { user_id: "did:privy:user1" };
    },
    async getUserLinkedAccounts() {
      calls.lookup++;
      if (opts.accounts instanceof Error) throw opts.accounts;
      return opts.accounts ?? LINKED;
    },
  };
  return { backend, calls };
}

async function main() {
  // ═══ Bearer parsing ═══════════════════════════════════════════════════
  assertEqual(parseBearerToken(null), null, "no header → null");
  assertEqual(parseBearerToken(""), null, "empty header → null");
  assertEqual(parseBearerToken("Basic abc"), null, "non-Bearer scheme → null");
  assertEqual(parseBearerToken("Bearer "), null, "empty Bearer → null");
  assertEqual(parseBearerToken("Bearer notajwt"), null, "non-JWT Bearer → null");
  assertEqual(parseBearerToken(`Bearer ${FAKE_JWT} extra`), null, "trailing garbage → null");
  assertEqual(parseBearerToken(`Bearer ${FAKE_JWT}`), FAKE_JWT, "well-formed Bearer → token");

  // ═══ Linked EVM wallet matching ═══════════════════════════════════════
  assert(isLinkedEvmWallet(LINKED, OWNER), "linked EVM wallet matches");
  assert(isLinkedEvmWallet(LINKED, OWNER.toLowerCase() as `0x${string}`), "match is case-insensitive");
  assert(!isLinkedEvmWallet(LINKED, OTHER), "smart wallet does not count as owner");
  assert(!isLinkedEvmWallet([], OWNER), "no linked accounts → no match");

  // ═══ Core: status codes ═══════════════════════════════════════════════
  {
    const r = await authenticateEvmOwnerWith(null, `Bearer ${FAKE_JWT}`, OWNER);
    assertEqual(r, { ok: false, status: 503, error: "Server authentication is not configured" }, "unconfigured → 503");
  }
  {
    const { backend, calls } = fakeBackend({});
    const r = await authenticateEvmOwnerWith(backend, null, OWNER);
    assert(!r.ok && r.status === 401, "missing token → 401");
    assertEqual(calls, { verify: 0, lookup: 0 }, "missing token: Privy never called");
  }
  {
    const { backend, calls } = fakeBackend({});
    const r = await authenticateEvmOwnerWith(backend, "Bearer garbage", OWNER);
    assert(!r.ok && r.status === 401, "malformed token → 401");
    assertEqual(calls.verify, 0, "malformed token: never sent to verifier");
  }
  {
    const { backend, calls } = fakeBackend({
      verify: async () => {
        throw new Error("signature verification failed");
      },
    });
    const r = await authenticateEvmOwnerWith(backend, `Bearer ${FAKE_JWT}`, OWNER);
    assert(!r.ok && r.status === 401, "invalid token → 401");
    assertEqual(calls.lookup, 0, "invalid token: no user lookup");
  }
  {
    const { backend } = fakeBackend({ verify: async () => ({ user_id: "" }) });
    const r = await authenticateEvmOwnerWith(backend, `Bearer ${FAKE_JWT}`, OWNER);
    assert(!r.ok && r.status === 401, "token without subject → 401");
  }
  {
    const { backend, calls } = fakeBackend({});
    const r = await authenticateEvmOwnerWith(backend, `Bearer ${FAKE_JWT}`, SOLANA);
    assert(!r.ok && r.status === 400, "Solana-shaped claimed wallet → 400");
    assertEqual(calls.lookup, 0, "non-EVM claim: no user lookup");
  }
  {
    const { backend } = fakeBackend({});
    const r = await authenticateEvmOwnerWith(backend, `Bearer ${FAKE_JWT}`, "");
    assert(!r.ok && r.status === 400, "empty claimed wallet → 400");
  }
  {
    const { backend } = fakeBackend({});
    const r = await authenticateEvmOwnerWith(backend, `Bearer ${FAKE_JWT}`, OTHER);
    assert(!r.ok && r.status === 403, "valid user, unlinked wallet → 403");
  }
  {
    const { backend } = fakeBackend({ accounts: [{ type: "wallet", chain_type: "solana", address: SOLANA }] });
    const r = await authenticateEvmOwnerWith(backend, `Bearer ${FAKE_JWT}`, OWNER);
    assert(!r.ok && r.status === 403, "user with only Solana wallet → 403");
  }
  {
    const { backend } = fakeBackend({ accounts: new Error("privy down") });
    const r = await authenticateEvmOwnerWith(backend, `Bearer ${FAKE_JWT}`, OWNER);
    assert(!r.ok && r.status === 503, "user lookup failure → 503 (fail closed)");
  }
  {
    const { backend } = fakeBackend({});
    const r = await authenticateEvmOwnerWith(backend, `Bearer ${FAKE_JWT}`, OWNER.toLowerCase());
    assertEqual(
      r,
      { ok: true, privyUserId: "did:privy:user1", ownerWallet: OWNER },
      "valid token + linked wallet → ok (checksummed owner)",
    );
  }

  // ═══ Official SDK verification with real ES256 tokens ═════════════════
  {
    const APP_ID = "test-app-id";
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const spki = await exportSPKI(publicKey);
    const { privateKey: wrongKey } = await generateKeyPair("ES256");
    const now = Math.floor(Date.now() / 1000);

    const sign = (o: { aud?: string; iss?: string; exp?: number; key?: CryptoKey }) =>
      new SignJWT({ sid: "session-1" })
        .setProtectedHeader({ alg: "ES256", typ: "JWT" })
        .setIssuer(o.iss ?? "privy.io")
        .setAudience(o.aud ?? APP_ID)
        .setSubject("did:privy:user1")
        .setIssuedAt(now - 60)
        .setExpirationTime(o.exp ?? now + 3600)
        .sign(o.key ?? privateKey);

    const backend: PrivyAuthBackend = {
      verifyAccessToken: (token) =>
        verifyAccessToken({ access_token: token, app_id: APP_ID, verification_key: spki }),
      getUserLinkedAccounts: async () => LINKED,
    };

    const ok = await authenticateEvmOwnerWith(backend, `Bearer ${await sign({})}`, OWNER);
    assert(ok.ok, "SDK: valid token + linked wallet → ok");

    const cases: Array<[string, Parameters<typeof sign>[0]]> = [
      ["expired", { exp: now - 10 }],
      ["wrong app (audience)", { aud: "other-app" }],
      ["wrong issuer", { iss: "evil.example" }],
      ["wrong signing key", { key: wrongKey }],
    ];
    for (const [label, o] of cases) {
      const r = await authenticateEvmOwnerWith(backend, `Bearer ${await sign(o)}`, OWNER);
      assert(!r.ok && r.status === 401, `SDK: ${label} token → 401`);
    }

    const unlinked = await authenticateEvmOwnerWith(backend, `Bearer ${await sign({})}`, OTHER);
    assert(!unlinked.ok && unlinked.status === 403, "SDK: valid token, unlinked wallet → 403");
  }

  // ═══ Static: routes authenticate before any key generation ════════════
  const root = process.cwd();
  for (const route of ["app/api/my-bot/route.ts", "app/api/my-bot/generate-wallet/route.ts"]) {
    const src = readFileSync(join(root, route), "utf8");
    const post = src.slice(src.indexOf("export async function POST"));
    const authAt = post.indexOf("authenticateEvmOwner(");
    const dbAt = post.indexOf(".from(userBots)");
    const genAt = post.indexOf("generateRobinhoodAgentWallet(");
    assert(authAt > 0, `${route}: POST calls authenticateEvmOwner`);
    assert(authAt < dbAt, `${route}: auth happens before any DB read`);
    assert(authAt < genAt, `${route}: auth happens before key generation`);
    assert(!/Solana|solana\//.test(post.match(/import[^;]+;/g)?.join("") ?? ""), `${route}: no Solana imports`);
  }
  // Every mutating handler under app/api/my-bot must authenticate before it
  // touches the DB — or be a fixed fail-closed stub that reads nothing.
  for (const dir of readdirSync(join(root, "app/api/my-bot"), { recursive: true }) as string[]) {
    if (!dir.endsWith("route.ts")) continue;
    const route = join("app/api/my-bot", dir);
    const src = readFileSync(join(root, route), "utf8");
    const handlers = src.split(/(?=export async function )/).slice(1);
    for (const h of handlers) {
      const method = /export async function (\w+)/.exec(h)?.[1];
      if (!method || method === "GET") continue;
      const readsState = /getDb\(|request\.json\(|generateRobinhoodAgentWallet\(/.test(h);
      if (!readsState) {
        assert(/status: (410|501)|return retired\(\)/.test(h), `${route} ${method}: stateless handler is a fail-closed stub`);
        continue;
      }
      const authAt = h.indexOf("authenticateEvmOwner(");
      const firstDb = h.search(/\.(select|update|insert|delete)\(/);
      assert(authAt > 0 && (firstDb < 0 || authAt < firstDb), `${route} ${method}: authenticates before DB access`);
    }
  }

  // ═══ House dashboard actions: verified signed-in user, no admin role ══
  {
    const ok = fakeBackend({}).backend;
    const r = await authenticateSignedInUserWith(ok, `Bearer ${FAKE_JWT}`);
    assert(r.ok, "signed-in user (valid Privy token) → allowed, no allowlist/role");
    const r1 = await authenticateSignedInUserWith(ok, null);
    assert(!r1.ok && r1.status === 401, "house action without token → 401 (not public)");
    const bad = fakeBackend({ verify: async () => { throw new Error("expired"); } }).backend;
    const r2 = await authenticateSignedInUserWith(bad, `Bearer ${FAKE_JWT}`);
    assert(!r2.ok && r2.status === 401, "house action with invalid/expired token → 401");
    const r3 = await authenticateSignedInUserWith(null, `Bearer ${FAKE_JWT}`);
    assert(!r3.ok && r3.status === 503, "house action with Privy unconfigured → 503 (fail closed)");
    const src = readFileSync(join(process.cwd(), "lib/auth/privy-server.ts"), "utf8");
    assert(!/HOUSE_ADMIN_WALLETS/.test(src), "no HOUSE_ADMIN_WALLETS requirement in server auth");
  }

  // Every mutating handler ANYWHERE under app/api must authenticate before
  // touching state — owner auth, house-admin auth, or a fail-closed stub.
  // Chat endpoints are the documented exception: they only call the LLM and
  // read public stats; they never write trading state.
  const CHAT_ONLY = new Set(["app/api/chat/route.ts", "app/api/atelier/chat/route.ts"]);
  for (const dir of readdirSync(join(root, "app/api"), { recursive: true }) as string[]) {
    if (!dir.endsWith("route.ts")) continue;
    const route = join("app/api", dir).replace(/\\/g, "/");
    const src = readFileSync(join(root, route), "utf8");
    for (const h of src.split(/(?=export async function )/).slice(1)) {
      const method = /export async function (\w+)/.exec(h)?.[1];
      if (!method || method === "GET") continue;
      if (CHAT_ONLY.has(route)) {
        assert(!/\.(update|insert|delete)\(/.test(h), `${route} ${method}: chat-only route performs no DB writes`);
        continue;
      }
      if (!/getDb\(|request\.json\(|\.(update|insert|delete)\(/.test(h)) {
        assert(/status: (410|501)|return retired\(\)/.test(h), `${route} ${method}: stateless handler is a fail-closed stub`);
        continue;
      }
      const authAt = h.search(/authenticate(EvmOwner|SignedInUser)\(/);
      const firstState = h.search(/\.(select|update|insert|delete)\(|updateSniperConfig\(|setPaused\(|recordClosedTrade\(/);
      assert(authAt > 0 && (firstState < 0 || authAt < firstState), `${route} ${method}: authenticated before any state access`);
    }
  }

  {
    const src = readFileSync(join(root, "app/api/my-bot/reveal-key/route.ts"), "utf8");
    assert(/status: 410/.test(src) && !/decryptSecret|agentSecretEnc/.test(src), "reveal-key stays retired (410, no key access)");
  }
  {
    const src = readFileSync(join(root, "app/api/my-bot/route.ts"), "utf8");
    assert(/withoutSecret\(bot\)/.test(src), "my-bot responses strip agentSecretEnc");
  }

  console.log(failures === 0 ? "\nAll Privy server auth tests passed." : `\n${failures} failure(s).`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
