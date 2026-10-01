# PR17 — Regression & Mainnet Readiness Matrix

Branch `feat/robinhood`, 2026-10-01. Mainnet state-changing transactions remain
**disabled in code** (signer, broadcaster, Lighter executor and registration all
refuse non-testnet) and **unauthorized**. This matrix assesses readiness; it does
not enable anything.

Legend: **READY** = implemented and verified (tests and/or live testnet) ·
**BLOCKED** = cannot proceed without a decision/input · **UNVERIFIED** = built,
not yet proven end-to-end.

| Capability | Status | Evidence / gap |
|---|---|---|
| Privy auth (server) | READY | Official `@privy-io/node`; real-token tests; live: owner auth passed in Docker app. `users()._get` kept per Privy docs (authoritative linked accounts). |
| Owner wallet ↔ bot ownership | READY | Linked-EVM-wallet check on every bot mutation; static sweep over all `app/api` mutating routes. |
| House administration | READY (config needed) | `HOUSE_ADMIN_WALLETS` gate on house config/toggle/lessons/trades; empty = nobody (fail closed). Set it before operating the house desk. |
| Autonomous agent wallet | READY | Generated via PR09 flow (live: `0xA81d…d531`), AES-256-GCM at rest. |
| Encrypted secret handling | READY | Agent key / Lighter API key (worker-only, AAD-bound) / canary key are three separate keys; none ever logged or returned. |
| DB (additive migrations) | READY | 0001–0005 additive; historical Solana rows untouched. |
| GMGN discovery (Robinhood) | READY | `chain=robinhood` live; rate limits (429) out of scope. |
| Safety / strategy / risk | READY | Suites green; thresholds unchanged; UI now edits the fields the Robinhood engine reads. |
| Paper trading | READY | Suite green; daemon Robinhood path unchanged. |
| V4 swap build / sign / broadcast | READY (testnet) | PR10 canary: buy/approve/permit2/sell success + rebroadcast no-op on 46630. |
| Live autonomous Robinhood trading in daemon | BLOCKED | Daemon is intentionally paper-only for Robinhood; wiring live execution needs an explicit decision. |
| Mainnet V4 execution | BLOCKED | Mainnet v4 contracts never independently verified; config fails closed. |
| Lighter perps (testnet) | READY | Live: account 282, API key idx 2 registered, order create → open-orders → cancel. |
| Lighter mainnet | BLOCKED | Executor/registration refuse mainnet; mainnet collateral is USDG via documented `deposit()` — needs approval. |
| Lighter realtime stream | UNVERIFIED | `account_all` parser/subscription tested offline; live subscribe verified, long-running use not. |
| Perpspad launch product | BLOCKED (product decision) | See PERPSPAD_DECISION.md (UNRESOLVED). |
| Alpha feeds | READY / UNVERIFIED | KOL/smart-money live on Robinhood; rank endpoint returned 429 during test; main Alpha table is historical Solana (Robinhood candidate feed not wired — decision needed). |
| UI identity | READY | ETH units / Robinhood explorer per row; historical Solana rows stay SOL. |
| Historical Solana reads | READY | Kept: Solana balance/market-cap readers, Drift market list, Perpspad rows. |
| House status panel daily PnL | UNVERIFIED | Still shows legacy Solana breaker state for the house desk. |
| Dependencies | READY | Solana/Codama deps removed; `@privy-io/node` added normally. |
| Env configuration | READY | `.env.example` documents all secrets; stale Solana vars removed. |
| Deployment signer artifact | READY | Dockerfile `lighter-signer` stage: pinned commit, `-buildvcs=false`, build fails on SHA-256 mismatch (re-pinned `411a3280…`, reproducible across clean/dirty checkouts). |

## Before any mainnet step (explicit approval required)
1. Verify Robinhood mainnet v4 contracts on-chain; then add mainnet execution config.
2. Decide live autonomous execution for the daemon.
3. Approve Lighter mainnet onboarding (USDG `deposit()` from agent wallet, then API-key registration).
4. Set `HOUSE_ADMIN_WALLETS`, production Privy secret, and production encryption keys (never reuse dev keys).
