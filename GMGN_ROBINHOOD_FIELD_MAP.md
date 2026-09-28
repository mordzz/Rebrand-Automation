# GMGN Robinhood Trenches — Field Map vs. Current PumpPortal/Pump.fun Fields

Source: `lib/solana/pumpportal.ts`, `lib/sniper/safety-checks.ts`, `lib/sniper/config.ts` (repo, read 2026-09-28) vs. `gmgn-cli` docs (`github.com/GMGNAI/gmgn-skills`: `docs/cli-usage.md`, `skills/gmgn-token/SKILL.md`, `skills/gmgn-market/SKILL.md`, `skills/gmgn-swap/SKILL.md`) — read 2026-09-28.

## PR05 update (2026-09-29): a verified baseline now exists, but not for Robinhood specifically

This repo already has a **working, production-verified** GMGN discovery adapter for Solana — `lib/gmgn/discovery.ts` — whose field names (`address`, `symbol`, `name`, `created_timestamp`, `launchpad_platform`, `renounced_mint`, `renounced_freeze_account`, `has_at_least_one_social`, `twitter`, `telegram`, `website`, `is_honeypot`, `buy_tax`, `sell_tax`, `rug_ratio`, `top_10_holder_rate`, `bundler_trader_amount_rate`, `suspected_insider_hold_rate`, `creator_balance_rate`, `creator_created_count`, `is_wash_trading`, `image_dup`, `usd_market_cap`, `total_supply`, `liquidity`, `holder_count`, `progress`, `smart_degen_count`, `renowned_count`) are confirmed against real production responses per that file's own comments ("verified against live rows", "measured live").

**PR05 could not complete its own mandatory verification step**: `GMGN_API_KEY` is unset in this environment, so no live authenticated call to `chain=robinhood` was possible. `lib/gmgn/discovery-robinhood.ts` uses the Solana adapter's field names as a documented *working hypothesis* (GMGN's docs describe one shared schema/wrapper across the chains it indexes), **not** a verified Robinhood-specific mapping. Everything below this point that predates this update should be read as background/documentation-derived context; the table immediately below reflects the more authoritative (but still chain-unconfirmed) Solana-verified baseline.

| Field (verified name, `chain=sol`) | Robinhood status |
|---|---|
| `address` | Used as-is by `normalizeRobinhoodToken`, validated as `0x[0-9a-fA-F]{40}` — UNVERIFIED that Robinhood responses use this same key |
| `created_timestamp` | Same, UNVERIFIED for Robinhood |
| `launchpad_platform` | Same, UNVERIFIED — critically, the actual value set for Robinhood (`trench`/`pons`/etc.) vs. what GMGN returns is unconfirmed |
| `renounced_mint` / `renounced_freeze_account` | **Deliberately NOT carried into the Robinhood type at all** — these are Solana-SPL concepts with no EVM equivalent; inventing an always-null field would misrepresent "not a concept" as "not yet checked" |
| `has_at_least_one_social`, `twitter`, `telegram`, `website` | Carried over, UNVERIFIED for Robinhood |
| `is_honeypot`, `buy_tax`, `sell_tax`, `rug_ratio`, `top_10_holder_rate`, `bundler_trader_amount_rate`, `suspected_insider_hold_rate`, `creator_balance_rate`, `creator_created_count`, `is_wash_trading`, `image_dup` | Carried over, UNVERIFIED for Robinhood — these are honeypot/tax/EVM-native risk signals GMGN's Solana docs already frame as chain-agnostic, so more likely to hold than the Solana-SPL fields above, but still unconfirmed |
| `usd_market_cap`, `total_supply`, `liquidity`, `holder_count`, `progress`, `smart_degen_count`, `renowned_count` | Carried over, UNVERIFIED for Robinhood |
| Creator/deployer address | **Confirmed absent even in the verified Solana response** — `lib/gmgn/discovery.ts`'s `DiscoveredToken` type has no such field. Not a Robinhood-specific gap; this was already unavailable on the working chain too. `creatorAddress` in the Robinhood type is always `null`. |

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

## Open items to resolve before PR05/PR06 implementation (do not silently resolve by assumption)

1. Confirm exact `RankItem` JSON field names by pulling a live/sample `market trenches --chain robinhood --raw` response — several fields above (creator address, initial-buy amount, social links, creation timestamp) were not itemized in the documentation excerpts available and must be verified against real payloads, not assumed.
2. Decide the Robinhood launchpad-platform allow-list scope (full default vs. curated subset) — this is a product/risk decision, not a technical one; recommend escalating to the user before PR05.
3. Determine whether "creator buy %" and "social link required" checks have any viable GMGN data source; if genuinely absent, decide whether to drop, replace with an alternative signal, or block that specific check (flag in `MIGRATION_BLOCKERS.md`) rather than silently disabling it.
