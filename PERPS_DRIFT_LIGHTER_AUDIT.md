# Perps: Drift (Solana) → Lighter (Robinhood Chain) Capability Audit

Source: `lib/perps/program.ts`, `onchain.ts`, `markets.ts`, `fee-split.ts`, `perpspad-types.ts`, `programs/perpspad/src/{lib.rs,state.rs}` (repo, read 2026-09-28) vs. Lighter's Robinhood-chain instance as documented via Bitquery (`docs.bitquery.io/docs/blockchain/robinhood/lighter-perp-dex-api/`), DeFiLlama (`lighter-robinhood-perps`), and Robinhood Chain ecosystem docs — read 2026-09-28. **Lighter's own native docs (`docs.lighter.xyz`) were referenced by secondary sources but not directly fetched in this pass — treat anything not explicitly sourced from Bitquery below as UNVERIFIED and confirm against `docs.lighter.xyz` before implementation.**

## Important framing correction

Lighter's existence on Robinhood Chain is **CONFIRMED**, not a blocker. What follows audits *feature parity* between Noah's current (mostly not-yet-implemented) Drift/Perpspad plan and what Lighter's Robinhood instance actually exposes — the blocker, if any, is in specific capabilities, not the provider choice.

## Baseline: what Noah's perps code currently actually does

Critically, most "Drift capabilities" listed in the original brief are **not yet implemented in this codebase** — `lib/perps/*` today is Phase-0/1 scaffolding:
- No order placement code exists.
- No PnL calculation exists (fields are typed but unpopulated — `perpspad-types.ts` marks them "populated at runtime," no populating code found).
- No funding, liquidation, deposit, or withdraw code exists.
- No live subaccount/collateral handling exists.
- The only "live" data path is `getMarketPrices()` in `markets.ts`, which pulls from **Pyth Hermes**, not Drift directly — this is chain-agnostic and needs no migration.
- The Anchor program (`programs/perpspad`) does no live Drift CPI — `underlying_market_index` is stored as a plain number field, and the per-token "Drift authority" PDA is derived but never used to call into Drift.

This changes the audit's scope: there is very little *working* Drift integration to port. The larger question is whether the **planned** Perpspad architecture (fee-split accounting + collateral top-up + buyback/burn on top of a Drift/Lighter perp position) still makes sense once a real Lighter integration is built, or whether Lighter's own accounting supersedes parts of it.

## Capability matrix

| Capability | Used By (current code) | Lighter Equivalent (Robinhood instance) | Status |
|---|---|---|---|
| Market discovery | `lib/perps/markets.ts` static `drift-markets.json` list | Lighter registers markets via `CreateMarket` / `RegisterAssetConfig` on-chain events (Bitquery-documented) | PARTIAL — on-chain registration events are visible, but the full queryable market-list/metadata API (symbols, tick sizes, leverage limits) is not confirmed from Bitquery alone; check `docs.lighter.xyz` |
| Market data (price/mark) | `getMarketPrices()` via Pyth Hermes | Chain-agnostic already; Lighter's zk engine has its own internal mark price feed used for matching, but Noah can likely keep using Pyth directly | VERIFIED (no change needed) — but confirm Lighter's own price isn't required for order placement inputs |
| Account / subaccount | Not implemented (PDA type only: `driftSubaccountAuthority` field, unused) | Lighter uses `toAccountIndex` (per Bitquery `Deposit` event schema) — an internal account-index concept inside the rollup, not a Solana-style subaccount PDA | DIFFERENT_SEMANTICS — no 1:1 mapping exists; needs its own design once Lighter API docs are read directly |
| Collateral | Typed field `collateralUsdc` (USDC), unpopulated | Lighter's Robinhood instance collateral is **USDG** (not USDC), 6 decimals, contract `0x5fc...` (per Bitquery); deposited via on-chain `Deposit` event, locked in Lighter's rollup contract | MISSING/needs rework — Noah's schema and types assume USDC; must switch to USDG. Do not assume native ETH or USDC is collateral. |
| Position | Typed fields only, unpopulated | Positions are managed inside the zk rollup — **not individual Robinhood Chain transactions** per Bitquery docs; requires Lighter's off-chain API/WS, not on-chain reads | MISSING — architecture must shift from "read an on-chain account" to "call Lighter's API/subscribe to Lighter's WS," a materially different integration pattern than the current Anchor-account-read model |
| Order (open) | Not implemented | Off-chain, inside Lighter's matching engine per Bitquery docs — requires Lighter's own order-submission API | MISSING — no on-chain equivalent exists to read/write directly; must integrate Lighter's API |
| Order (cancel) | Not implemented | Same as above | MISSING |
| PnL | Typed field only | Computed inside Lighter's rollup; exposed via Lighter API, not on-chain | MISSING |
| Funding | Not implemented | Presumed handled inside Lighter's engine (standard perp-DEX pattern) — not confirmed via Bitquery excerpt | UNVERIFIED |
| Leverage | `targetLeverage` field (Perpspad's own cap, `MAX_LEVERAGE=20` in the Anchor program) | Lighter almost certainly enforces its own leverage limits per market; Noah's `MAX_LEVERAGE` cap would need to be reconciled with Lighter's actual limits, not assumed compatible | UNVERIFIED |
| Liquidation | Not implemented; `status` enum includes `Liquidated` | Handled inside Lighter's zk engine | MISSING (from Noah side) — Noah would need to consume Lighter's liquidation events/notifications, not implement its own |
| Deposit | Not implemented | On-chain `Deposit` event: `toAccountIndex`, `toAddress`, `assetIndex`, `baseAmount` (Bitquery-documented, VERIFIED as on-chain-visible) | VERIFIED (data shape), integration work needed |
| Withdraw | Not implemented | On-chain `WithdrawPending` event queues the withdrawal; actual USDG transfer completes it (Bitquery-documented) | VERIFIED (data shape), integration work needed |
| Historical data | Not implemented | Bitquery's `combined` dataset (historical) vs `realtime` dataset (live) — both documented as available via Bitquery's GraphQL layer, which is a third-party indexer, not Lighter's own API | PARTIAL — usable as a data source, but production integration should likely go through Lighter's own API/WS rather than a third-party indexer |
| Realtime/WebSocket | Not implemented | Bitquery documents WebSocket subscription support for realtime events; Lighter's own API is expected to have its own WS (per general zk-perp-DEX pattern) but not directly confirmed here | UNVERIFIED — must check `docs.lighter.xyz` directly |
| Rollup/batch lifecycle (informational) | N/A | `BatchCommit`, `BatchVerification`, `BatchesExecuted`, `StateRootUpdate` events, ~1 batch/minute (Bitquery-documented) | VERIFIED — useful for confirming settlement finality/timing expectations, not a Noah feature per se |
| Priority/escape-hatch requests | N/A | `NewPriorityRequest` events for forced operations (Bitquery-documented) | VERIFIED (exists), purpose/usage for Noah not yet applicable |

## On-chain program (`programs/perpspad`) re-assessment

- `initialize_config`, `update_fee_split`, `set_paused` — generic fee-split/admin accounting, **no Drift or Lighter dependency**. These could be ported to a Solidity contract on Robinhood Chain as-is if Noah still wants its own fee-split/governance-burn accounting layer independent of Lighter.
- `register_token` — the one Drift-coupled instruction (stores `underlying_market_index`, derives a per-token Drift-authority PDA). Since Lighter's Robinhood instance uses an internal account-index model (not Solana-style PDAs) and manages collateral/positions inside its own rollup, this instruction's design **does not map 1:1** — it would need to be redesigned around whatever "register this token's perp market mapping" concept Lighter's actual API exposes (if any), not mechanically translated.

## Status summary

| Status | Count | Notes |
|---|---|---|
| VERIFIED | 5 (market data via Pyth, deposit shape, withdraw shape, batch lifecycle, priority requests) | Chain-agnostic or directly Bitquery-documented |
| PARTIAL | 2 (market discovery, historical data) | Some data available, full production API not confirmed |
| DIFFERENT_SEMANTICS | 1 (account/subaccount model) | Fundamentally different architecture (rollup-internal vs. on-chain PDA) |
| MISSING (needs new integration, not a port) | 6 (collateral currency mismatch, position, order open/cancel, PnL, liquidation) | Requires direct Lighter API/WS integration — this is genuinely new work, not a mechanical replacement |
| UNVERIFIED | 3 (funding, leverage limits, realtime WS) | Must confirm against `docs.lighter.xyz` directly before implementation |

## Recommendation

Perps migration is **not blocked** on provider selection (Lighter is confirmed), but it **is currently a mostly-greenfield integration** rather than a "swap Drift for Lighter" port, because the existing Drift integration was never fully built. Treat PR11/PR12 (perps migration) as:
1. Read `docs.lighter.xyz` directly (not yet done in this audit) to close the UNVERIFIED/PARTIAL rows above.
2. Decide collateral currency (USDG, per confirmed Robinhood-instance fact) and update `perpspadTokens`/`perpspad-types.ts` accordingly (additive, per PR04's non-destructive pattern).
3. Redesign the account/position/order data flow around Lighter's actual API shape, preserving Noah's existing `/perps` UI/UX (market selector, ticker, positions, PnL display) as the fixed target, per brief §15.
4. Re-scope `programs/perpspad`'s `register_token` instruction once Lighter's real market-registration/account-index model is known — do not port it mechanically.
