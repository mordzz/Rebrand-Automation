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
      }
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
