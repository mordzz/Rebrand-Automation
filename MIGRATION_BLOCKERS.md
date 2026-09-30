# Migration Blockers

Categories: `CONFIRMED` (fact verified against current official docs/code), `LIKELY` (strong evidence, not fully verified), `UNVERIFIED` (plausible but not checked against primary docs), `BLOCKED` (cannot proceed without a decision or missing capability), `DOES_NOT_MAKE_SENSE` (a naive 1:1 translation that must not be implemented as-is).

## CONFIRMED

- Robinhood Chain is a permissionless, fully EVM-compatible Arbitrum-Orbit L2 (chain id 4663 mainnet / 46630 testnet), not a fixed stock-token-only chain. Contract deployment is open to anyone. (Corrects the initial migration brief's premise.)
- GMGN supports `--chain robinhood` with `market trenches` (`new_creation`/`pump`[requested as `near_completion`]/`completed`), token security data, holders, smart-money/KOL data, quotes, and swap execution (`gmgn-cli swap --chain robinhood`), plus condition orders (TP/SL) on the `robinhood` chain.
- Lighter runs a dedicated Robinhood-chain instance ("ZkLighter") for perpetuals — confirmed by Bitquery's dedicated Lighter-Robinhood API docs and DeFiLlama's `lighter-robinhood-perps` protocol page. It is not the only perps DEX on Robinhood Chain (Arcus also listed).
- Lighter's Robinhood-instance collateral currency is **USDG**, not USDC and not native ETH. Current schema (`perpspadTokens.collateralUsdc`, `perpspad-types.ts` USDC fields) assumes the wrong currency and must be corrected — not silently renamed, since the number format/decimals (USDG is 6 decimals) must also be re-verified.
- Lighter's positions/orders/PnL/funding/liquidations happen inside its zk rollup, not as individually-readable Robinhood Chain transactions. Only deposits, pending withdrawals, and batch-lifecycle events are on-chain-visible. This means Noah's current on-chain-PDA-account-read pattern (used for Perpspad on Solana) **cannot be mechanically ported** — a Lighter API/WS integration is required instead.
- The Anchor program's `register_token` instruction is the only Drift-coupled on-chain instruction, and it currently performs no live Drift CPI — it just stores a market-index number and derives an unused PDA. The rest of the program (`initialize_config`, `update_fee_split`, `set_paused`) is generic accounting with no Solana/Drift dependency.
- Noah's perps feature set (order placement, PnL, funding, liquidation, deposit/withdraw, subaccount handling) is **largely unimplemented today** — the Drift integration being migrated is mostly a plan/type-scaffold, not working code. This changes the effort profile of PR11/12 from "port" to "build."

## LIKELY

- GMGN's `RankItem` schema (returned by `market trenches`) contains creator/dev address and creation-timestamp fields, but the exact key names were not itemized in the documentation excerpts reviewed — likely present, needs confirmation against a live/raw API response before coding `lib/discovery/robinhood-trenches.ts`.
- Lighter's Robinhood instance likely enforces its own per-market leverage caps distinct from Perpspad's `MAX_LEVERAGE=20` constant; likely also has its own funding-rate mechanism (standard for perp DEXs) — needs direct confirmation from `docs.lighter.xyz`.

## UNVERIFIED

- Whether GMGN's Robinhood `RankItem` schema includes a "creator initial-buy amount" or equivalent field needed to replicate Noah's `creatorBuyPercent()` safety check. Not found in the documentation excerpts reviewed.
- Whether GMGN's Robinhood trenches response includes token social-link metadata (twitter/telegram/website) needed for the `requireSocialLink` safety check, or whether that requires a separate per-token detail call.
- Lighter's realtime/WebSocket API shape for position/order/PnL updates on the Robinhood instance specifically (Bitquery documents its own WS for indexed events, which is a third-party indexer, not necessarily Lighter's native API).
- Whether Lighter's Robinhood instance exposes a queryable market list/metadata API (symbols, tick sizes) beyond the on-chain `CreateMarket`/`RegisterAssetConfig` registration events.

## BLOCKED

- **Sniper "creator buy %" and "social link required" checks** cannot be implemented against Robinhood Chain data until the two UNVERIFIED items above are resolved. Do not disable these checks silently; either find a GMGN data source, substitute an equivalent signal (documented explicitly), or explicitly disable with a logged/flagged decision requiring sign-off.
- **Perps order placement, PnL, liquidation, funding** cannot be implemented until Lighter's own API docs (`docs.lighter.xyz`) are read directly — Bitquery's third-party indexer view only covers on-chain-visible events (deposits/withdrawals/batch lifecycle), not the off-chain rollup-internal state these features need.
- **Robinhood launchpad-platform allow-list scope** (which of the ~26 default platforms, e.g. `trench`, `pons`, `virtuals`, `clanker`, `bankr`, to actually snipe from) is a product-risk decision, not a technical one — current safety checks were designed only against pump.fun's single, well-understood bonding-curve mechanics. Enabling the full default allow-list without per-platform review risks applying pump.fun-shaped safety logic to launch mechanics it was never designed to evaluate.

## DOES_NOT_MAKE_SENSE (guard against these specific naive translations)

- Assuming Drift's Solana API shape (subaccounts, on-chain PDAs for positions) maps 1:1 to Lighter's Robinhood instance — it does not; Lighter's state is rollup-internal, exposed via API, not on-chain reads.
- Treating "mint authority renounced" / "freeze authority renounced" as EVM concepts with direct equivalents — they don't exist on EVM; `owner_renounced` and `is_blacklist` are the closest available proxies, not literal translations, and must be documented as approximations in the code.
- Assuming Perpspad's `collateralUsdc`-denominated types can just be relabeled to "native" — the actual Lighter-Robinhood collateral currency is USDG, a specific token with its own contract and decimals, not a generic stablecoin placeholder.
- Assuming every one of GMGN's ~26 default Robinhood launchpad platforms behaves like pump.fun's bonding-curve model closely enough for existing safety checks to transfer unchanged — some (e.g. `virtuals`, `clanker`, `bankr`) are known to have materially different launch/agent-token mechanics elsewhere in the industry and must not be lumped in without individual review.
- Assuming GMGN condition orders (documented TP/SL support on `--chain robinhood`) should replace Noah's own risk-engine exit logic — the brief requires the risk engine to remain application-owned; GMGN's condition orders are at most a future optimization, not a required migration substitution.
- Regenerating the Anchor program's TS client tooling (Codama) for a ported Solidity contract — Codama targets Anchor/Solana IDLs specifically and has no EVM equivalent role; a ported contract would use a different toolchain (e.g. viem + TypeChain/wagmi codegen) entirely, not "the same generator pointed at Solidity."
