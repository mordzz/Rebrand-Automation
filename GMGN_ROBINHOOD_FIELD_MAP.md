# GMGN Robinhood Trenches — Field Map vs. Current PumpPortal/Pump.fun Fields

Source: `lib/solana/pumpportal.ts`, `lib/sniper/safety-checks.ts`, `lib/sniper/config.ts` (repo, read 2026-09-28) vs. `gmgn-cli` docs (`github.com/GMGNAI/gmgn-skills`: `docs/cli-usage.md`, `skills/gmgn-token/SKILL.md`, `skills/gmgn-market/SKILL.md`, `skills/gmgn-swap/SKILL.md`) — read 2026-09-28.

## LIVE-VERIFIED 2026-09-29: real `chain=robinhood` payload reviewed

`npm run inspect:gmgn-robinhood` was run against GMGN's public read-only demo API key (`chain=robinhood`, `new_creation`, no launchpad filter, 60 items returned, one point-in-time sample). This is the first section in this document backed by an actual response rather than documentation or a Solana-adapter-derived guess — everything below in this section supersedes the corresponding claims further down the file, which are kept for history, not as current guidance.

### Representative sanitized item

```json
{
  "address": "0xc3185178243c5a8f85abe1e52fe4119298ba7777",
  "symbol": "FAR",
  "name": "Far Protocol",
  "creator": "0x8bf8eace53982a349195c452d1a22d025fae6666",
  "created_timestamp": 1790620671,
  "launchpad": "flap",
  "launchpad_platform": "flap",
  "market_cap": 5131.21,
  "liquidity": 0.004131894081536473,
  "total_supply": 1000000000,
  "holder_count": 2,
  "is_honeypot": "no",
  "owner_renounced": "yes",
  "open_source": "yes",
  "burn_status": "yes",
  "buy_tax": 0.0899,
  "sell_tax": 0.0899,
  "creator_balance_rate": 0,
  "creator_created_count": 13116,
  "creator_token_status": "creator_hold",
  "twitter": "FarProtocol",
  "telegram": "https://t.me/#0x...",
  "website": "https://farprotocol.app",
  "is_wash_trading": false,
  "top_10_holder_rate": 0,
  "suspected_insider_hold_rate": 0,
  "bundler_trader_amount_rate": 0
}
```

(Addresses/handles are real but public on-chain/social data from live tokens — not secrets. Full raw sample not committed to the repo.)

### Exact field names actually returned (superset across 60 items — not every field appears on every item)

`address`, `bot_degen_count`, `bot_degen_rate`, `bundler_mhr`, `bundler_trader_amount_rate`, `burn_status`, `buy_tax`, `buy_tips`, `buys_24h`, `callout_count`, `chain`, `co_d`, `complete_cost_time`, `complete_timestamp`, `created_timestamp`, `creation_tool`, `creator`, `creator_balance_rate`, `creator_created_count`, `creator_created_inner_count`, `creator_created_open_count`, `creator_created_open_ratio`, `creator_token_status`, `cto_flag`, `dev_team_hold_rate`, `dev_token_burn_amount`, `dev_token_burn_ratio`, `dexscr_ad`, `dexscr_boost_fee`, `dexscr_trending_bar`, `dexscr_update_link`, `entrapment_ratio`, `exchange`, `fee_params`, `fresh_wallet_rate`, `fund_from_address`, `fund_from_ts`, `has_at_least_one_social`, `holder_count`, `image_dup`, `is_honeypot`, `is_og`, `is_wash_trading`, `launchpad`, `launchpad_platform`, `launchpad_status`, `liquidity`, `logo`, `logo_small_base64`, `market_cap`, `mk`, `name`, `net_buy_24h`, `new_wallet_volume`, `open_source`, `open_timestamp`, `owner_renounced`, `pool_address`, `price`, `progress`, `quote_address`, `quote_address_type`, `rat_trader_amount_rate`, `renowned_count`, `s_qsafe`, `sell_tax`, `sells_24h`, `seq_index`, `smart_degen_count`, `sniper_count`, `status`, `suspected_insider_hold_rate`, `swaps_24h`, `symbol`, `tax_allocation`, `telegram`, `telegram_dup`, `tg_call_count`, `top70_sniper_hold_rate`, `top_10_holder_rate`, `total_buy_tax`, `total_fee`, `total_sell_tax`, `total_supply`, `trade_fee`, `trans_name_zhcn`, `trans_symbol_zhcn`, `tweet_publish_time`, `twitter`, `twitter_change_flag`, `twitter_create_token_count`, `twitter_del_post_token_count`, `twitter_dup`, `twitter_handle`, `twitter_is_tweet`, `twitter_rename_count`, `visiting_count`, `volume_24h`, `website`, `website_dup`, `x_user_follower`, `x_user_following`.

**No `usd_market_cap` key appeared in any sampled item** — the field is `market_cap`.

### `launchpad_platform` values actually observed

Only **`flap`**, **`flap_pve`**, **`longxyz`** across all 60 sampled items. **`trench` and `pons` — the earlier documentation-derived allow-list guess — were not observed at all.** That guess should not be used as a starting point for the production allow-list decision; treat it as superseded.

### Comparison against `lib/gmgn/discovery-robinhood.ts` and the earlier (pre-verification) mapping in this file

| Item | Earlier assumption | Live-verified finding | Adapter status |
|---|---|---|---|
| `address` | UNVERIFIED for Robinhood | Confirmed: 40-hex-char (`0x` + 20 bytes) EVM address, matches the Solana adapter's key name | Correct as-is |
| `created_timestamp` | UNVERIFIED | Confirmed: Unix seconds, matches | Correct as-is |
| `launchpad_platform` | UNVERIFIED which values exist | Confirmed key name; **observed values (`flap`/`flap_pve`/`longxyz`) contradict the `trench`/`pons` guess** | No code change needed (adapter never hardcoded a default — see `resolveLaunchpadAllowlist`) — only the guess in this document is corrected |
| `symbol`, `name`, `twitter`, `telegram`, `website`, `has_at_least_one_social` | UNVERIFIED | Confirmed present with expected shape. `has_at_least_one_social` only present on ~half of items (boolean when present) | Correct as-is — the `?? Boolean(twitter\|\|telegram\|\|website)` fallback is exactly what covers the other half |
| `market_cap` vs `usd_market_cap` | Assumed `usd_market_cap` primary, `market_cap` fallback (copied from Solana) | **`usd_market_cap` never appears; `market_cap` is the actual field.** Denomination unconfirmed (no currency label on the field itself) but observed scale (~$5,000 for fresh launches) is consistent with USD | Already correct by luck — the existing `?? ` fallback chain resolves to `market_cap` — but the field name priority/comment was backwards and has been corrected |
| `liquidity` | Assumed same USD unit as market cap (per the Solana adapter's comment) | **Liquidity values (~0.001–0.005) are on a completely different scale than market_cap (~5,000) in the same items — they do NOT share a unit on Robinhood.** Likely native-ETH-denominated | Not yet consumed by any safety logic in this PR (PR05 doesn't touch `safety.ts`) — **flagged as a PR06 blocker**: `lib/gmgn/safety.ts`'s liquidity-floor logic assumes a shared unit with market cap, which will be wrong here if ported unchanged |
| Creator/deployer address | Assumed absent (inherited from the Solana adapter, which has no such field) | **`creator` is present on 60/60 sampled items, valid EVM address.** This was a genuine gap in the Solana-derived hypothesis, now corrected | `creatorAddress` now mapped from `raw.creator` (was hardcoded `null`) |
| Creator-holding data | Assumed `creator_balance_rate`/`creator_created_count` (copied from Solana) | Confirmed present under the same key names | Correct as-is |
| `is_honeypot` and similar security flags | Assumed JSON boolean (copied from Solana) | **`is_honeypot`, `owner_renounced`, `open_source`, `burn_status` use GMGN's own `"yes"`/`"no"`/`"unknown"` STRING convention on this chain** — `is_wash_trading`/`has_at_least_one_social` remain real JSON booleans | `bool()` helper was silently mis-parsing `"no"` as `null` (unknown) instead of `false` — **fixed** to also recognize `"yes"`/`"no"` strings |
| `owner_renounced`, `open_source`, `burn_status` | Not previously known to exist | Confirmed present, `"yes"` on every sampled item (no `"no"` observed in this sample) | **Not added to `RobinhoodDiscoveredToken` or any safety check in this PR** — deciding whether/how these map to Noah's mint/freeze-authority-equivalent checks is explicitly PR06's job |
| Nested "security" object | Unknown | **None found** — no `blacklist`/`proxy`/`pausable`/`mintable`/`hidden_owner` keys anywhere in the sample; risk signals are all flat scalar fields | No nested-object handling needed |
| `total_supply`, `holder_count` | UNVERIFIED | Confirmed present, expected shape (`total_supply` consistently `1000000000` in this sample — fixed-supply meme-token pattern, same as Solana) | Correct as-is |

### Unit contract: `buy_tax`/`sell_tax` are 0–1 ratios upstream, `buyTaxPct`/`sellTaxPct` are 0–100 percentages here

GMGN's raw `buy_tax`/`sell_tax` fields are **0–1 ratios** (`0.03` = 3%, `0.0899` ≈ 8.99%) — this matches GMGN's own documentation and is confirmed by the live Robinhood sample (`buy_tax: 0.0899` on a token whose displayed tax is clearly meant to read as ~9%, not 0.09%). `lib/gmgn/discovery-robinhood.ts`'s `buyTaxPct`/`sellTaxPct` fields are named — and documented — as 0–100 percentages, matching every other `*Pct` field in this codebase (`maxCreatorBuyPct`, `takeProfitPct`, etc.). The normalizer now converts at the boundary (`ratioToPct()`) so a caller reading `buyTaxPct` gets an actual percentage, not a ratio 100x too small.

**Other 0–1 ratio fields (`rugRatio`, `top10HolderRate`, `bundlerRate`, `insiderHoldRate`, `creatorHoldRate`, `progress`) are deliberately NOT converted** — they're named `*Rate`/`rugRatio`/`progress`, not `*Pct`, so there's no equivalent naming contract implying 0–100. This fix is scoped to the two fields whose names actually promise a percentage.

**Not applied to `lib/gmgn/discovery.ts` (Solana)** — that adapter has the identical `buyTaxPct: num(raw.buy_tax)` pattern and likely has the same unit bug, but fixing it is out of scope here: it's a separate, pre-existing issue in already-shipped Solana code, not something this Robinhood-migration PR should silently touch.

### Caveat

This was a single ~60-item sample from one point in time, via a shared public demo key — strong evidence, not an exhaustive audit. No `is_honeypot: "yes"` or `owner_renounced: "no"` was observed, which doesn't mean those values never occur; safety logic (PR06) should not assume this sample was exhaustive.

## PR05 update (2026-09-29): a verified baseline now exists, but not for Robinhood specifically

This repo already has a **working, production-verified** GMGN discovery adapter for Solana — `lib/gmgn/discovery.ts` — whose field names (`address`, `symbol`, `name`, `created_timestamp`, `launchpad_platform`, `renounced_mint`, `renounced_freeze_account`, `has_at_least_one_social`, `twitter`, `telegram`, `website`, `is_honeypot`, `buy_tax`, `sell_tax`, `rug_ratio`, `top_10_holder_rate`, `bundler_trader_amount_rate`, `suspected_insider_hold_rate`, `creator_balance_rate`, `creator_created_count`, `is_wash_trading`, `image_dup`, `usd_market_cap`, `total_supply`, `liquidity`, `holder_count`, `progress`, `smart_degen_count`, `renowned_count`) are confirmed against real production responses per that file's own comments ("verified against live rows", "measured live").

**PR05 could not complete its own mandatory verification step**: `GMGN_API_KEY` is unset in this environment, so no live authenticated call to `chain=robinhood` was possible. `lib/gmgn/discovery-robinhood.ts` uses field names from two different, non-equivalent sources of confidence — do not conflate them:

- **DOCUMENTED by GMGN for `market trenches` generally** (per `gmgn-cli`/`gmgn-skills` docs): `address`, `symbol`, `name`, `launchpad_platform`, `usd_market_cap`, `liquidity`, `total_supply`, `created_timestamp`, `twitter`, `telegram`, `website`, `has_at_least_one_social`. This is documentation for the trenches response shape in general, not specifically confirmed for `chain=robinhood`.
- **LIVE-VERIFIED against a real response** — only true for `chain=sol`, via `lib/gmgn/discovery.ts` (that file's own comments: "verified against live rows", "measured live"). Its fuller field set (the documented fields above, plus risk signals like `is_honeypot`/`buy_tax`/`rug_ratio`/`top_10_holder_rate`/etc.) is what `lib/gmgn/discovery-robinhood.ts`'s field names are copied from, as a working hypothesis.

**Neither of these constitutes "live-verified for `chain=robinhood` specifically."** That requires running `npm run inspect:gmgn-robinhood` with a real `GMGN_API_KEY` and reviewing the actual response — not yet done. Everything below this point that predates this update should be read as background/documentation-derived context; the table immediately below distinguishes documented-generally from verified-for-Solana-only.

| Field | Status |
|---|---|
| `address` | DOCUMENTED (general) + LIVE-VERIFIED (`chain=sol`). Used as-is by `normalizeRobinhoodToken`, validated as `0x[0-9a-fA-F]{40}` — NOT live-verified for `chain=robinhood` |
| `created_timestamp` | Same status as `address` |
| `launchpad_platform` | Same status as `address` — critically, the actual value set for Robinhood (`trench`/`pons`/etc.) vs. what GMGN returns is unconfirmed |
| `renounced_mint` / `renounced_freeze_account` | **Deliberately NOT carried into the Robinhood type at all** — these are Solana-SPL concepts with no EVM equivalent; inventing an always-null field would misrepresent "not a concept" as "not yet checked" |
| `has_at_least_one_social`, `twitter`, `telegram`, `website` | DOCUMENTED (general) + LIVE-VERIFIED (`chain=sol`). NOT live-verified for `chain=robinhood` |
| `is_honeypot`, `buy_tax`, `sell_tax`, `rug_ratio`, `top_10_holder_rate`, `bundler_trader_amount_rate`, `suspected_insider_hold_rate`, `creator_balance_rate`, `creator_created_count`, `is_wash_trading`, `image_dup` | LIVE-VERIFIED (`chain=sol`) only — not found in the general trenches documentation excerpts reviewed. NOT live-verified for `chain=robinhood`. GMGN frames these as chain-agnostic risk signals, so more likely to carry over than the Solana-SPL fields above, but still unconfirmed |
| `usd_market_cap`, `total_supply`, `liquidity`, `holder_count`, `progress` | DOCUMENTED (general, partial: `usd_market_cap`/`liquidity`/`total_supply`) + LIVE-VERIFIED (`chain=sol`, full set). NOT live-verified for `chain=robinhood`. Denomination (USD vs. native) and semantics of `liquidity`/`market_cap` for Robinhood specifically are unconfirmed |
| `smart_degen_count`, `renowned_count` | LIVE-VERIFIED (`chain=sol`) only. NOT live-verified for `chain=robinhood` |
| Creator/deployer address | Not mapped by the existing (verified, `chain=sol`) adapter, and not confirmed present in the documented trenches response shape either — live Robinhood payload verification is required before this can be populated or declared absent. `creatorAddress` in the Robinhood type is kept as always `null` for now; no raw key name has been invented for it. |

## Before PR06/PR07 proceed on real data

`npm run inspect:gmgn-robinhood` (added in PR05) must be run with a real `GMGN_API_KEY` and the actual response reviewed for, at minimum: creator/dev data, social fields, security fields, creator-holding/creator-buy data, exact launchpad values, timestamp behavior, and the denomination/meaning of liquidity and market-cap fields. Do not weaken an existing Noah safety check merely because a field remains unavailable after that review — surface it as missing/blocked instead (see MIGRATION_BLOCKERS.md).

**Action required before PR06 (safety adaptation) or PR07 (paper trading) proceed on real data**: run `npm run inspect:gmgn-robinhood` (added in PR05, `scripts/inspect-gmgn-robinhood.ts`) once a real `GMGN_API_KEY` is available, compare the raw output against `normalizeRobinhoodToken()`, and update both that function and this table from what actually comes back — not from this Solana-derived hypothesis.

## 1. Discovery event shape

| Existing PumpPortal Field | Purpose in Noah | GMGN Robinhood Equivalent | Exact / Approximate / Missing |
|---|---|---|---|
| `signature` (tx sig of create event) | Provenance/logging | Robinhood-chain tx hash on the launchpad's create tx (not explicitly itemized in GMGN docs excerpt) | Approximate — needs confirmation from raw `market trenches` response |
| `mint` (token mint address) | Primary token identifier | `address` (ERC-20 contract address in `RankItem`) | Exact (concept), format changes `base58 → 0x...` |
| `traderPublicKey` (creator wallet, on create) | Creator identity for buy-% and blocklist checks | Creator/dev info field in `RankItem` ("Creator/dev info" — exact key name not itemized in doc excerpt) | Approximate — confirm exact field name (`creator_address` or similar) before coding |
| `txType` (only `"create"` accepted) | Filters to new-listing events only | `data.new_creation` category key from `market trenches --type new_creation` | Exact — GMGN's category replaces the txType filter entirely |
| `initialBuy` (creator's initial buy amount) | Numerator of `creatorBuyPercent()` | Not confirmed present in `RankItem` — GMGN doc excerpt didn't itemize a creator-initial-buy field | Missing — flag in blockers, may need a different formula sourced from holder/trade data |
| `solAmount` (SOL size of initial buy) | Denominator input alongside `initialBuy` | N/A (native asset is ETH, not SOL) — same Missing status as above | Missing |
| `bondingCurveKey` | Internal pump.fun bonding-curve account ref | No bonding-curve equivalent — Robinhood launchpads (trench, pons, etc.) may not all use pump.fun-style bonding curves | Missing/Different-semantics — must verify per-launchpad-platform, not assumed uniform |
| `vTokensInBondingCurve`, `vSolInBondingCurve` (virtual reserves, explicitly already unused as safety signal per code comment) | Denominator for creator-buy%; not used for liquidity floor | `liquidity` field in `RankItem` | Approximate — `liquidity` is a real pooled-liquidity number, not a virtual bonding-curve reserve, likely an improvement but changes the creator-buy% math basis |
| `marketCapSol` | Display/threshold input | `market_cap` in `RankItem` | Exact (concept), denominated in USD not native asset — check |
| `name`, `symbol` | Blocked-keyword matching, display, `symbolKey` dedup | `symbol` field in `RankItem` (name not confirmed itemized) | Approximate |
| `uri` (off-chain metadata JSON: socials) | Social-link requirement check | Not confirmed in `RankItem` schema excerpt — may need a separate GMGN token-detail call | Missing — flag as blocker; may require `gmgn-token` skill's per-token detail endpoint rather than the trenches list response |
| `pool` (must equal `"pump"`) | Restricts to pump.fun venue only | `--launchpad-platform` filter (repeatable), Robinhood default allow-list includes `trench`, `pons`, `noxa`, `dyorswap`, `apestore`, `printr`, `virtuals`, `bankr`, `clanker`, `klik`, `livo`, `flap`, `flap_stocks`, `flap_pve`, `bags`, `bowfun`, `o1`, `circus`, `arrowfinance`, `longxyz`, `motion`, `stoxes_tax`, `stoxes`, `holoworld`, `pewfun`, `dyorfun_v3`, `noxafi` | Different-semantics — was a single fixed venue (`"pump"`), becomes a curated multi-platform allow-list; **decision needed**: keep the full default allow-list, or restrict to a subset (e.g. just `trench`+`pons`) matching pump.fun's risk profile most closely |
| (no timestamp on create event — age measured from local receipt clock) | `minTokenAgeSec`/`maxTokenAgeSec` checks | GMGN `RankItem` likely has creation timestamp (not itemized in excerpt) — if present, switching to API-provided age is an improvement but changes behavior (local-clock age → API age) | Approximate — verify before switching semantics |

GMGN's three trenches categories replace the single PumpPortal `txType==="create"` stream with a three-stage funnel:
- `data.new_creation` → analog of "just created," closest to current discovery trigger.
- `data.pump` (returned under this key even though requested via `--type near_completion`) → tokens nearing bonding-curve completion / graduation; **no current Noah equivalent** — could be used for a secondary "graduating" strategy or ignored for v1 parity.
- `data.completed` → already graduated; **no current Noah equivalent**, likely out of scope for the sniper's "catch it early" strategy.

**Recommendation for v1 parity**: subscribe only to `new_creation`, filtered to a launchpad-platform allow-list decided by the team (candidates: `trench`, `pons` as the closest analogs to pump.fun's permissionless-launch model) — do not enable the full default allow-list without a platform-by-platform safety review, since `virtuals`, `clanker`, `bankr` etc. have materially different launch mechanics that current safety checks were never designed against.

## 2. Safety checks

| Existing Check | Data Source Today | GMGN Robinhood Equivalent | Exact / Approximate / Missing |
|---|---|---|---|
| Mint authority renounced | Solana mint account byte parse (offset 0) | EVM chains have no mint-authority concept; GMGN's EVM security schema returns `owner_renounced` (contract ownership renounced) instead | Different-semantics — closest available proxy, not a literal equivalent; document this substitution explicitly in `safety-checks.ts` |
| Freeze authority renounced | Solana mint account byte parse (offset 46) | No direct EVM analog; closest available signal is `is_blacklist` (contract has a wallet-blacklist function) inverted | Different-semantics — flag as approximate |
| Token-2022 extension refusal (transfer-fee etc.) | On-chain extension parse | EVM equivalent risk data: `buy_tax`/`sell_tax` (transaction taxes), `is_honeypot` (buy succeeds, sell always fails — direct analog to "extension that blocks exit"), `flags[]` (hidden owner, owner can modify balances/taxes, trading cooldown, self-destruct) | Approximate — `is_honeypot` + high `sell_tax` together are the closest match to "can't exit the position," but the check needs a new threshold policy, not a 1:1 port |
| Creator buy % | Computed from `initialBuy`/`vTokensInBondingCurve` | Missing per section 1 above — no confirmed GMGN field | Missing — blocker |
| Social link present | Parsed from `uri` metadata JSON | Missing per section 1 above | Missing — blocker |
| Alpha wallet buy detection | `getTokenAccountsByOwner` polling (Solana RPC) | EVM ERC-20 `balanceOf(wallet, token)` polling via viem against Robinhood Chain RPC — same polling architecture, different RPC call | Exact (concept), REPLACE implementation |
| Blocked keyword match (name/symbol) | String match on PumpPortal fields | String match on GMGN `RankItem.symbol`/name field | Exact, pending confirmed field name |
| Pool/venue scope (`pool === "pump"`) | PumpPortal field | `--launchpad-platform` filter, see section 1 | Exact (concept), different value space |
| Min/max token age | Local receipt clock | See section 1, verify GMGN timestamp field | Approximate |

Additional GMGN security fields with **no current Noah check but available** (candidates for new, explicitly-approved checks — do not silently add per brief §10):
- `rug_ratio` (0–1 risk score)
- `lock_summary.is_locked` / `lock_summary.lock_percent` (LP lock status)
- `is_honeypot` (direct rug/exit-blocking signal)
- `flags[]` (hidden owner, cooldown, self-destruct, etc.)
- holder-concentration data from `gmgn-token` holders endpoint

## 3. Execution

| Current | GMGN Robinhood Capability | Status |
|---|---|---|
| Jupiter quote → build tx → sign → broadcast | `gmgn-cli order quote --chain robinhood` (quote only) and `gmgn-cli swap --chain robinhood` (quote+execute, requires `GMGN_PRIVATE_KEY`) | VERIFIED as existing — GMGN itself can serve as the Jupiter-equivalent execution provider on Robinhood Chain, subject to latency/slippage validation before committing (see PR08 in plan) |
| TP/SL exit orders (currently Noah-side polling loop) | GMGN "condition orders" documented as supported on `sol/bsc/base/eth/robinhood` (not on `arc`/`stable`) | VERIFIED available, but brief requires **preserving Noah's own risk engine as the source of truth** — recommend continuing to use Noah's polling-based exit logic and treat GMGN condition orders as a possible future optimization, not a required migration item, to avoid ceding risk-engine authority to an external provider |

## Approved v1 launchpad: Pons V2 (verified 2026-09-29, supersedes the earlier Flap decision)

Live-queried `chain=robinhood`, `new_creation`, `launchpad_platform=pons` via the public GMGN demo key: **5 real candidates returned.** For one (`0xc65a2de34f972ab545b4c74414b42aad3e9f31b9`, "zerozec"/ZZEC), verified:

- `launchpad_platform: "pons"`, valid 40-hex EVM address, stage `new_creation` (from the query itself)
- `/v1/token/security` responded fully: `is_renounced: true` (owner-renounced), `is_blacklist: false`, `is_honeypot: false` (real boolean here), `buy_tax`/`sell_tax`: `"0"`, `top_10_holder_rate: "0"`
- Trenches fields: `rug_ratio: 0`, `bundler_trader_amount_rate: 0`, `suspected_insider_hold_rate: 0`, `is_wash_trading: false`, `creator_balance_rate: 0`, `twitter`/`telegram`/`website`: `""`, `created_timestamp: 1790656123` (valid Unix seconds)
- `/v1/token/info`: `progress: 0`, `launchpad_status: 0`, `migrated_timestamp: 0`, `migration_market_cap: 0` — confirmed pre-graduation

`Flap` (the previously-approved v1 launchpad) is **superseded** by this decision — Flap is not GMGN's currently-documented "Robinhood Cooking"-supported launchpad; Pons has stronger current documentation support. See `lib/gmgn/safety-robinhood.ts` and `.env.example` for the current `GMGN_ROBINHOOD_LAUNCHPADS=pons` policy.

### CORRECTION 2026-09-29: the "no liquidity floor" conclusion above was wrong — on-chain verification against Robinhood mainnet

The initial architectural read (Pons ≈ pre-DEX bonding curve, parity with pump.fun) was an inference from documentation and GMGN's `pool.exchange: "uniswap_v3"` label alone — not verified on-chain. Direct on-chain investigation (Robinhood Chain **mainnet**, chain id 4663 — an earlier check mistakenly queried testnet and returned no bytecode for anything, which was itself a red flag, not evidence of anything) disproved it:

- The pool contract at `0xea7217d61cbed34bd99352143d6bdc6ad9a8a2fb` is a real, live, ~44KB deployed contract implementing the full Uniswap V3 pool interface (`factory()`, `token0()`, `token1()`, `fee()`, `liquidity()` all callable, all return sane values) — a genuine, immediately-tradeable AMM pool from token creation, not a bonding-curve stand-in.
- On-chain ERC-20 `balanceOf` reserves at the pool **exactly match** GMGN's reported `base_reserve`/`quote_reserve` — GMGN's reserve numbers are real on-chain state, not synthetic.
Reproduced identically on 2 further live-sampled `pons new_creation` candidates (3/3 consistent — all real Uniswap V3 pools with real reserves, no bonding curve found for any of them).

### CORRECTION 2026-09-29 (second pass): `pool.factory()` does not identify the launchpad — it identifies the DEX

An earlier version of this document used the pool's on-chain `factory()` result (`0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`) to conclude that `pons` and `flap` "share a factory" and that GMGN's `launchpad_platform` label therefore doesn't correspond to a distinct launchpad. **That conclusion was invalid.** `0x1f7d7550...` is simply **the Uniswap V3 Factory deployment on Robinhood Chain** — the shared DEX infrastructure every pool of that type points back to, regardless of which upstream launchpad created it. Two different launchpads that both build on Uniswap V3 would naturally produce pools whose `factory()` returns this same address; it proves nothing about the launchpad itself.

**Corrected method**: traced the actual launch **transaction** instead. For the sampled `pons` token, the earliest transaction was the creator wallet calling directly into `0xf4fc0cd27fc8ecf17e55ee4c3f7201897df3eb75` (selector `0x686399cb`) — one atomic call that triggered the token mint, Uniswap V3 pool creation, and several other contracts' log emissions. This address matches **none** of the three supplied "Pons" candidate factories (active/legacy direct-pool, or V2) — its identity as "Pons" specifically is therefore **UNRESOLVED against the supplied candidate list**, though a real, distinct on-chain launch initiator was found (this is not the same as "not a Pons launch" — the supplied candidate list may simply be non-exhaustive or outdated).

For comparison, the same tracing method on a `flap`-labeled token (`0xc3185178...`, "Far Protocol") found a **different** call target: `0x8bf8eace53982a349195c452d1a22d025fae6666`. **`pons` and `flap` do route through distinct on-chain contracts** — correcting the earlier "shared factory" claim, which was an artifact of both ultimately settling on the same underlying DEX (Uniswap V3), not evidence they're the same launch mechanism.

**Pons vs Flap comparison** (evidence gathered so far):

| Attribute | Pump.fun (reference) | Pons (sampled) | Flap (sampled) |
|---|---|---|---|
| New token stage | bonding curve | real Uniswap V3 pool from creation | real Uniswap V3 pool from creation (assumed same pattern; not independently re-verified this pass) |
| Bonding curve? | Yes | No evidence found (3/3 samples) | Not re-verified this pass |
| Real DEX pool exists immediately? | No (post-graduation only) | Yes | Yes (per PR05 sample data) |
| Graduation? | Yes (curve → Raydium) | Not observed/not applicable (already a pool) | Not re-verified |
| DEX after graduation | Raydium | N/A | N/A |
| GMGN new_creation support | N/A (native PumpPortal) | Confirmed live | Confirmed live (earlier sample) |
| GMGN security fields sufficient | N/A | Yes (full field set responded) | Yes (full field set responded, PR06) |
| Evidence confidence | reference | Medium — on-chain launch tx traced, pool verified; launchpad brand identity vs. supplied candidates unresolved | Low — only the distinct call-target fact re-confirmed this pass, not a full re-audit |

**Recommendation**: Neither `pons` nor `flap`, on the evidence gathered, matches pump.fun's actual bonding-curve-then-graduate lifecycle — both appear to create a real, live DEX pool immediately at token creation. This means the original "choose the platform closest to pump.fun's workflow" premise does not have a confirmed winner between the two; the earlier "Pons V2 curve" justification for keeping `pons` was wrong. `pons` remains the v1 discovery launchpad for now (a separate, still-valid decision — GMGN documents current support for it, and full security-field data is available), but the **liquidity policy no longer assumes bonding-curve parity with pump.fun** — see below.

**Conclusion (liquidity)**: a real DEX pool with real (if currently tiny) reserves exists from the moment a `pons new_creation` token is created. Liquidity is a genuine risk property here, not an inapplicable pre-DEX concept. The liquidity floor has been **reinstated as an unconditional blocker** in `lib/gmgn/safety-robinhood.ts` — every Robinhood candidate now refuses on this point until an explicit threshold decision is made.

**Liquidity-unit investigation**: GMGN's documentation explicitly defines `liquidity` (trenches, token/info, `pool.liquidity`) as USD-denominated, computed from `base_reserve_value + quote_reserve_value`. Checked against real data: on the sampled token, `base_reserve_value = 0` (the new token has no discovered price yet) and `quote_reserve_value = 0.00002684741500033486`; their sum does NOT equal the reported `liquidity` (`0.00005286778200534018`) — `liquidity` is instead ≈2× the quote-side value alone. This is plausibly still consistent with the documented USD contract (a "double the priced side" TVL estimate when the other side has no price yet) rather than a bug, but **every `new_creation` token structurally has `base_reserve_value = 0`**, making the documented sum-formula untestable on this population with the samples available. With only one usable data point and no independent ETH/USD price-feed cross-check, this does not meet "multiple samples consistently support the documented contract." Classified **UNRESOLVED**, not VERIFIED USD. Per "if unresolved, fail closed," no unit-based threshold is attempted; the blocker refuses unconditionally instead.

Do not choose a `minLiquidityUsd` threshold until this is properly resolved with a larger, non-degenerate sample (e.g. `near_completion`/`completed`-stage tokens that do have an established price on both sides) — which is itself out of v1's `new_creation`-only scope.

## Open items to resolve before PR05/PR06 implementation (do not silently resolve by assumption)

1. Confirm exact `RankItem` JSON field names by pulling a live/sample `market trenches --chain robinhood --raw` response — several fields above (creator address, initial-buy amount, social links, creation timestamp) were not itemized in the documentation excerpts available and must be verified against real payloads, not assumed.
2. Decide the Robinhood launchpad-platform allow-list scope (full default vs. curated subset) — this is a product/risk decision, not a technical one; recommend escalating to the user before PR05.
3. Determine whether "creator buy %" and "social link required" checks have any viable GMGN data source; if genuinely absent, decide whether to drop, replace with an alternative signal, or block that specific check (flag in `MIGRATION_BLOCKERS.md`) rather than silently disabling it.
