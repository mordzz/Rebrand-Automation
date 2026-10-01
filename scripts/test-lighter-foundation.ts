/**
 * PR11 Lighter foundation tests.
 *
 * Offline: parsing of documented fields, network config separation,
 * error mapping, and rollup-contract network check (fake fetcher).
 * Live (read-only, skipped with --offline or when unreachable): the active
 * network's Lighter API — /info rollup check, markets, account lookup.
 *
 * Run: npm run test:lighter-foundation
 */
import { ROBINHOOD_CHAIN_IDS, ROBINHOOD_NETWORK } from "@/lib/chain/config";
import { LighterApiError, LighterClient, parseAccount, parseMarket } from "@/lib/lighter/client";
import { getLighterConfig } from "@/lib/lighter/config";
import { parseAccountFrame, streamUrl, subscribeAccount } from "@/lib/lighter/websocket";

let failures = 0;
function assert(condition: boolean, label: string): void {
  if (!condition) {
    console.error(`[FAIL] ${label}`);
    failures++;
  } else {
    console.log(`[PASS] ${label}`);
  }
}

const fake = (routes: Record<string, { status?: number; body: unknown }>) => async (url: string) => {
  const hit = Object.entries(routes).find(([k]) => url.includes(k));
  if (!hit) throw new Error(`network down: ${url}`);
  return new Response(JSON.stringify(hit[1].body), { status: hit[1].status ?? 200 });
};

async function main() {
  // ═══ Config ═══════════════════════════════════════════════════════════
  const t = getLighterConfig("testnet");
  const m = getLighterConfig("mainnet");
  assert(t.apiBaseUrl.includes("rh-testnet") && !m.apiBaseUrl.includes("testnet"), "testnet/mainnet API hosts are distinct");
  assert(t.lighterChainId === 300 && m.lighterChainId === 466324, "Lighter L2 chain ids per docs");
  assert(
    t.lighterChainId !== ROBINHOOD_CHAIN_IDS.testnet && m.lighterChainId !== ROBINHOOD_CHAIN_IDS.mainnet,
    "Lighter chain ids are never confused with Robinhood EVM chain ids",
  );
  assert(getLighterConfig().network === ROBINHOOD_NETWORK, "Lighter network follows active Robinhood network");

  // ═══ Parsing ══════════════════════════════════════════════════════════
  const mk = parseMarket({
    symbol: "ETH", market_id: 0, market_type: "perp", status: "active", size_decimals: 4, price_decimals: 2,
    min_base_amount: "0.0050", min_quote_amount: "10.000000", min_initial_margin_fraction: 200,
    maintenance_margin_fraction: 120, mark_price: "4012.55", index_price: "4011.90", daily_price_change: -1.5, open_interest: 12,
  });
  assert(mk?.maxLeverage === 50, "max leverage = 10000 / min_initial_margin_fraction");
  assert(mk?.markPrice === "4012.55", "prices stay decimal strings");
  assert(parseMarket({ symbol: "X", market_id: 1, market_type: "spot" }) === null, "spot markets excluded from perps");

  const acct = parseAccount({
    account_index: 47, l1_address: "0xabc", collateral: "500.000000", available_balance: "480.5", total_asset_value: "500",
    assets: [
      { symbol: "ETH", margin_mode: "disabled", margin_balance: "0" },
      { symbol: "USDG", margin_mode: "enabled", margin_balance: "500.000000" },
    ],
    positions: [{ market_id: 0, symbol: "ETH", sign: -1, position: "0.5", avg_entry_price: "4000", unrealized_pnl: "-6.2", realized_pnl: "0", liquidation_price: "4800" }],
  });
  assert(acct.collateralAssets.length === 1 && acct.collateralAssets[0].symbol === "USDG", "collateral = margin-enabled asset, read not assumed");
  assert(acct.positions[0].size === "0.5" && acct.positions[0].sign === -1, "position size and raw sign passed through uninterpreted");

  // ═══ Client behaviour (fake fetcher) ══════════════════════════════════
  {
    const c = new LighterClient(t, fake({ "/info": { body: { contract_address: t.rollupContract.toLowerCase() } } }));
    await c.assertNetwork();
    assert(true, "rollup contract matches (case-insensitive) → network ok");
  }
  {
    const c = new LighterClient(t, fake({ "/info": { body: { contract_address: m.rollupContract } } }));
    let kind = "";
    try { await c.assertNetwork(); } catch (e) { kind = e instanceof LighterApiError ? e.kind : "?"; }
    assert(kind === "wrong_network", "mainnet rollup on testnet config → wrong_network");
  }
  {
    const c = new LighterClient(t, fake({ accountsByL1Address: { status: 400, body: { code: 21100, message: "account not found" } } }));
    const subs = await c.getSubAccounts("0x0000000000000000000000000000000000000002");
    assert(subs.length === 0, "unknown L1 address → no sub-accounts (not an error)");
  }
  {
    const c = new LighterClient(t, fake({}));
    let kind = "";
    try { await c.getMarkets(); } catch (e) { kind = e instanceof LighterApiError ? e.kind : "?"; }
    assert(kind === "unavailable", "network failure → unavailable (fail closed)");
  }
  {
    const c = new LighterClient(t, fake({}));
    let threw = false;
    try { await c.getSubAccounts("not-an-address"); } catch { threw = true; }
    assert(threw, "non-EVM L1 address refused before any request");
  }

  // ═══ Authed/public read endpoints (fake fetcher) ══════════════════════
  {
    const seen: Array<{ url: string; auth?: string }> = [];
    const c = new LighterClient(t, async (url, headers) => {
      seen.push({ url, auth: headers?.authorization });
      if (url.includes("accountActiveOrders")) return new Response(JSON.stringify({ code: 200, orders: [{ order_index: 281474976710656, client_order_index: 7, market_index: 0, is_ask: true, type: "limit", time_in_force: "good-till-time", reduce_only: false, price: "4050.00", initial_base_amount: "0.1000", remaining_base_amount: "0.1000", filled_base_amount: "0", status: "open" }] }));
      if (url.includes("apikeys")) return new Response(JSON.stringify({ code: 200, api_keys: [{ account_index: 47, api_key_index: 2, nonce: 4, public_key: "0xab" }] }));
      if (url.includes("positionFunding")) return new Response(JSON.stringify({ code: 200, position_fundings: [{ timestamp: 1, market_id: 0, change: "-0.01", rate: "0.0001", position_size: "0.1", position_side: "long" }] }));
      return new Response(JSON.stringify({ code: 200, fundings: [{ timestamp: 1, value: "0.03", rate: "0.0012", direction: "long" }] }));
    });
    const orders = await c.getActiveOrders(47, "tok123");
    assert(orders[0].orderIndex === 281474976710656 && orders[0].isAsk && orders[0].price === "4050.00", "active orders parsed (official Order fields)");
    assert(seen[0].auth === "tok123", "active orders sent with authorization header, not in URL");
    assert(!seen[0].url.includes("tok123"), "auth token never placed in the URL");
    assert((await c.getApiKeys(47, 2))[0].publicKey === "0xab", "api keys parsed");
    const empty = new LighterClient(t, fake({ apikeys: { status: 400, body: { code: 21200, message: "api key not found" } } }));
    assert((await empty.getApiKeys(47, 9)).length === 0, "empty key slot (\"api key not found\") → [] not an error");
    assert((await c.getPositionFunding(47, "tok123"))[0].change === "-0.01", "position funding parsed");
    assert((await c.getFundingRates(0))[0].rate === "0.0012", "funding rates parsed");
  }

  // ═══ WebSocket (official account_all channel) ═════════════════════════
  assert(streamUrl(t) === "wss://api.rh-testnet.lighter.xyz/stream", "stream URL per official client (/stream)");
  assert(parseAccountFrame(JSON.stringify({ type: "update/account_all", channel: "account_all:47", account: 47, positions: {} }), 47)?.kind === "update", "update frame parsed");
  assert(parseAccountFrame(JSON.stringify({ type: "subscribed/account_all", channel: "account_all:47" }), 47)?.kind === "snapshot", "snapshot frame parsed");
  assert(parseAccountFrame(JSON.stringify({ type: "update/account_all", account: 48 }), 47) === null, "other account's frame ignored");
  assert(parseAccountFrame("not json", 47) === null && parseAccountFrame(JSON.stringify({ type: "connected" }), 47) === null, "non-account frames ignored");
  {
    const sent: string[] = [];
    class FakeWS {
      onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null; onerror = null; onclose: (() => void) | null = null;
      constructor(readonly url: string) { setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ type: "update/account_all", account: 47 }) }); }, 0); }
      send(m: string) { sent.push(m); }
      close() {}
    }
    const got: string[] = [];
    const sub = subscribeAccount(47, (m) => got.push(m.kind), { config: t, WebSocketImpl: FakeWS as unknown as typeof WebSocket });
    await new Promise((r) => setTimeout(r, 20));
    sub.close();
    assert(sent.length === 1 && JSON.parse(sent[0]).channel === "account_all/47", "subscribes only to account_all/<index>");
    assert(got.join() === "update", "stream delivers account updates");
  }

  // ═══ Live read-only (active network) ══════════════════════════════════
  if (!process.argv.includes("--offline")) {
    const c = new LighterClient();
    try {
      await c.assertNetwork();
      assert(true, `live: ${c.config.network} Lighter API serves expected rollup ${c.config.rollupContract}`);
      const markets = await c.getMarkets();
      assert(markets.length > 0 && markets.every((x) => x.maxLeverage > 0), `live: ${markets.length} perp markets with leverage limits`);
      const subs = await c.getSubAccounts("0x0000000000000000000000000000000000000001");
      if (subs.length > 0) {
        const a = await c.getAccount(subs[0].accountIndex);
        assert(a.accountIndex === subs[0].accountIndex, `live: account ${a.accountIndex} readable (collateral ${a.collateralAssets.map((x) => x.symbol).join(",") || "none"})`);
        assert(Array.isArray(await c.getApiKeys(subs[0].accountIndex, 2)), "live: empty api key slot reads as [] (not an error)");
      }
      const rates = await c.getFundingRates(markets[0].marketId, 3);
      assert(Array.isArray(rates), `live: funding rates readable (${rates.length} points)`);
    } catch (error) {
      if (error instanceof LighterApiError && error.kind === "unavailable") console.log(`[SKIP] live Lighter unreachable: ${error.message}`);
      else throw error;
    }
  }

  console.log(failures === 0 ? "\nAll Lighter foundation tests passed." : `\n${failures} failure(s).`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
