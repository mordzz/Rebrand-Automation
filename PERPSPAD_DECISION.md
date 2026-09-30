# PR13 — Perpspad Final Decision

Decided after PR11/PR12 established what Lighter (Robinhood Chain perps) actually
provides. Principle: keep what still serves Noah or history, replace what Lighter
already does, retire what only existed for the Solana/Drift design, and never port
Anchor/Solana code for symmetry.

Context that drove the decisions:

- Perpspad's design was a per-token Solana program PDA that CPIs into Drift. The
  Anchor program never performed a live Drift CPI (see `PERPS_DRIFT_LIGHTER_AUDIT.md`)
  and was only ever deployed to Solana devnet.
- Lighter is an off-chain-matched zk rollup: positions, orders and margin live in
  Lighter's engine and are reached via its API/signer (PR11/PR12), not via a
  program Noah owns. There is no per-token on-chain position account to port.
- Noah's own perps execution now exists and is live-verified on testnet:
  agent-wallet-owned Lighter account → official-signer API key → orders/positions/PnL.

## Classification

| Component | Decision | Action |
|---|---|---|
| `programs/perpspad/**` (Anchor), `Anchor.toml`, `Cargo.toml`, `Cargo.lock` | **RETIRE** | Removed. Solana-only, devnet-only, no live Drift CPI; Lighter replaces the position layer. Not ported to Solidity (no product need). Recoverable from git history. |
| `package.json` `deploy:perpspad` (anchor deploy) | **RETIRE** | Removed. |
| `lib/perps/launch.ts` (`register_token` builder stub) | **RETIRE** | Removed — fail-closed stub with no callers. |
| `lib/perps/onchain.ts` (PerpToken reader stub) | **RETIRE** | Removed — always returned `null`. |
| `POST /api/perps/tokens` (ingest by Solana mint) | **RETIRE** | Removed. Its only evidence source was the retired Solana program, so it could never record anything. |
| `lib/perps/tokens.ts` `ingestOnChainToken` / `createPendingPerpspadToken` | **RETIRE** | Removed — only served the retired launch/ingest paths. |
| `lib/perps/markets.ts` Pyth/Hermes pricing (`getMarketPrices`) | **REPLACE → retired** | Removed. `/api/perps/markets` uses Lighter's own mark prices since PR11. |
| `/api/perps/markets`, `use-markets`, `market-ticker`, `market-selector` | **PORT** (done PR11) | Serve active Lighter markets; response shape unchanged. |
| Perps execution (open/close/leverage/margin/PnL/funding) | **REPLACE** (done PR12) | `lib/lighter/*`, `/api/my-bot/perps*`. Positions/margin/liquidation handled by Lighter's engine. |
| `perpspad_tokens`, `perpspad_config` DB tables | **KEEP** | Historical Solana rows stay truthful. No destructive migration. |
| `GET /api/perps/tokens`, `lib/perps/tokens.ts` read side, `live-positions.tsx` | **KEEP** (historical read) | Renders historical Perpspad rows. Drift-era copy is a PR14 terminology item. |
| `lib/perps/markets.ts` Drift market list (`drift-markets.json`) | **KEEP** (historical read) | Needed to resolve `underlying_market_index` of historical rows. Never used for new orders. |
| `lib/perps/program.ts` Solana explorer link + migration message | **KEEP** (historical read) | Historical Solana signatures/addresses must link to the Solana explorer. |
| `lib/perps/fee-split.ts`, `GET /api/perps/config`, `fee-flow-diagram` | **KEEP OFF-CHAIN** | Fee-split accounting is chain-agnostic config (no Drift/Lighter dependency). Still GET-only; any write path needs admin auth first. |
| `perpspad-types.ts` | **KEEP** | Types of historical rows. Drift field names are historical data shape, not runtime. |
| Token launch product (`create-token-form.tsx`, "Launch" tab) — "launch a token backed by a perp position with fee buyback/burn" | **UNRESOLVED** | Stays in its explicit paused state. Lighter's official signer exposes public-pool/share primitives (`SignCreatePublicPool`, `SignMintShares`, `SignBurnShares`) that could underpin a pool-backed token, but mapping Perpspad's token/fee-burn economics onto them is a **product decision**, not a migration step. Not implemented, not faked. |

## What was deliberately not done

- No Solidity port of the Anchor program (no product need, and Lighter owns positions).
- No recreation of per-token PDA / Drift-authority architecture.
- No Lighter public-pool integration — needs a product decision first (UNRESOLVED above).
- No change to historical rows or tables.
