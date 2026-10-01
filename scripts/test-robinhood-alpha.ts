/**
 * Active Robinhood Alpha feed tests (lib/alpha/robinhood-alpha.ts).
 * Deterministic: fake GMGN discovery/security/evaluation. No network.
 *
 * Run: npm run test:robinhood-alpha
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { __resetRobinhoodAlphaForTests, getRobinhoodAlpha, type RobinhoodAlphaDeps } from "@/lib/alpha/robinhood-alpha";
import type { RobinhoodDiscoveredToken } from "@/lib/gmgn/discovery-robinhood";
import type { RobinhoodSafetyCheckResult } from "@/lib/gmgn/safety-robinhood";
import type { SniperConfig } from "@/lib/sniper/config";

let failures = 0;
function assert(c: boolean, label: string) {
  if (!c) {
    console.error(`[FAIL] ${label}`);
    failures++;
  } else console.log(`[PASS] ${label}`);
}

const tok = (addr: string, createdAt: number): RobinhoodDiscoveredToken =>
  ({ tokenAddress: addr, symbol: addr.slice(2, 6), name: "T", logo: null, launchpad: "pons", createdAt, chain: "robinhood" }) as unknown as RobinhoodDiscoveredToken;
const safety = (passed: boolean): RobinhoodSafetyCheckResult =>
  ({ passed, reasons: passed ? [] : ["refused"], ownerRenounced: true, isBlacklistCapable: false, creatorHoldPct: 2, creatorHoldPolicyConfigured: true, hasSocialLink: true, metadata: {}, alphaWalletDetected: null, matchedAlphaWallets: [] }) as RobinhoodSafetyCheckResult;

function deps(o: { failSecurity?: Set<string>; pass?: Set<string>; sources?: string[]; now: () => number; calls?: string[] }): RobinhoodAlphaDeps {
  return {
    now: o.now,
    discover: async () => ({ ok: true, tokens: [tok("0xaaaa", 1000), tok("0xbbbb", 2000), tok("0xcccc", 3000)] }),
    security: async (a) => (o.calls?.push(a), o.failSecurity?.has(a) ? { ok: false, reason: "provider_error", detail: "429" } : { ok: true, security: {} as never }),
    evaluate: async (t) => safety(o.pass?.has(t.tokenAddress) ?? false),
    houseConfig: async () => ({ entrySources: o.sources ?? ["gmgn"] }) as unknown as SniperConfig,
  };
}

async function main() {
  let t = 10_000_000;
  const now = () => t;

  __resetRobinhoodAlphaForTests();
  {
    const calls: string[] = [];
    const r = await getRobinhoodAlpha(deps({ now, pass: new Set(["0xbbbb"]), failSecurity: new Set(["0xcccc"]), calls }));
    assert(r.rows.length === 1 && r.rows[0].token === "0xbbbb", "only tokens that passed the house checks are listed");
    assert(r.rows[0].chain === "robinhood" && r.rows[0].safety.ownerRenounced === true, "rows carry EVM safety facts, chain=robinhood");
    assert(/security data unavailable/.test(r.error ?? ""), "missing security data surfaces as an error (fail closed)");
    assert(calls[0] === "0xcccc", "newest launches evaluated first");

    t += 10_000;
    const calls2: string[] = [];
    await getRobinhoodAlpha(deps({ now, pass: new Set(["0xbbbb", "0xcccc"]), calls: calls2 }));
    assert(calls2.length === 0, "no re-evaluation inside the 90s refresh window (rate-limit friendly)");

    t += 100_000;
    const calls3: string[] = [];
    const r3 = await getRobinhoodAlpha(deps({ now, pass: new Set(["0xbbbb", "0xcccc"]), calls: calls3 }));
    assert(calls3.join() === "0xcccc", "token with failed security is retried later; passed/refused ones are not re-fetched");
    assert(r3.rows.map((x) => x.token).sort().join() === "0xbbbb,0xcccc", "retried token listed once it passes");
  }

  __resetRobinhoodAlphaForTests();
  {
    const r = await getRobinhoodAlpha(deps({ now, sources: ["pump"] }));
    assert(r.rows.length === 0 && /gmgn/.test(r.error ?? ""), "house config without gmgn source → empty feed, explained");
  }

  __resetRobinhoodAlphaForTests();
  {
    const r = await getRobinhoodAlpha({ ...deps({ now }), discover: async () => ({ ok: false, reason: "provider_error", detail: "HTTP 429" }) });
    assert(r.rows.length === 0 && r.error === "provider_error", "GMGN discovery failure → empty feed with reason (never fabricated)");
  }

  const src = readFileSync(join(process.cwd(), "lib/alpha/robinhood-alpha.ts"), "utf8");
  assert(!/getDb|\.insert\(|\.update\(/.test(src), "feed never writes to the database");
  assert(/evaluateRobinhoodSafety/.test(src) && /getSniperConfig/.test(src), "uses the daemon's own safety evaluator with the house config");

  console.log(failures === 0 ? "\nAll Robinhood alpha tests passed." : `\n${failures} failure(s).`);
  process.exitCode = failures === 0 ? 0 : 1;
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
