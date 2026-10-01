# Mainnet Readiness Matrix

Branch `feat/robinhood`. Last updated 2026-10-01 (post-migration readiness phase).
**No mainnet state-changing transaction has ever been sent.** Robinhood mainnet
signing, broadcasting, v4 execution config, Lighter mainnet registration and
Lighter mainnet order execution all **refuse** — proven by
`npm run test:mainnet-guards` in a process configured for mainnet (4663).

Legend: **READY** = verified (tests and/or live read) · **BLOCKED** = needs an
operator decision/input · **UNVERIFIED** = built or partly evidenced, not proven.

## Matrix

| Capability | Status | Evidence / gap |
|---|---|---|
| Full Docker image build | READY | `docker build` of the real Dockerfile succeeded; `lighter-signer` stage cloned lighter-go @ `9d38261`, built with Go 1.23.2 `-trimpath -buildvcs=false`, `sha256sum -c` → `lighter-signer.wasm: OK`, `wasm_exec.js: OK`; runtime image contains `vendor/lighter-signer/` with `411a3280…1a2c54` / `45ce9dfe…c229`, the worker, and `.next/BUILD_ID`. Rebuilt after this phase's fixes (see report). |
| Privy server auth / owner ownership | READY | Official `@privy-io/node`; `users()._get` kept per Privy docs; static sweep: every mutating `app/api` route authenticates first. |
| House administration | BLOCKED (operator input) | `HOUSE_ADMIN_WALLETS` is empty → every house mutation refused (live: 401 without token, 401 forged token). Non-admin 403 / admin-allowed proven in unit tests only. Requires operator to name the admin wallet(s). |
| Agent wallet + encrypted secrets | READY | One agent ciphertext, one Lighter ciphertext in DB (see Secrets). |
| Safety / strategy / risk / paper | READY | Suites green; thresholds unchanged. |
| Robinhood **testnet** V4 execution | READY | PR10 canary (buy/approve/permit2/sell, rebroadcast no-op) on 46630. |
| Robinhood **mainnet** V4 contracts | READY (read-only) | Source: Uniswap v4 deployments page, "Robinhood Chain: 4663". Live (RPC chainId 4663): bytecode present for PoolManager `0x8366…0951`, Quoter `0x8dc1…8f94`, StateView `0xf333…673b`, PositionManager `0x58da…a7`, PositionDescriptor `0x9639…dc06`, ReservesLens `0x0000001b…865B`, UniversalRouter `0x8876…0904`, UniversalRouter 2.1.2 `0x204F…0498`, Permit2 `0x0000…8BA3`; `poolManager()` on Quoter/StateView/PositionManager/both routers == PoolManager; Permit2 `DOMAIN_SEPARATOR()` callable. WETH `0x0Bd7…AD73` and USDG `0x5fc5…d168` match docs.robinhood.com/chain/contracts. Recorded in `ROBINHOOD_MAINNET_V4_VERIFIED` (readiness only, not executable). |
| Router `0x06afBA43…F99` (docs-PR snippet only) | UNVERIFIED | Has code, but `poolManager()` reverts; not on current Uniswap page. Not used. |
| Mainnet quote (read-only) | READY | Hookless native-ETH/**real** USDG pools found via PoolManager `Initialize` logs (pool id re-derived = keccak(poolKey)); `eth_call` Quoter: 0.00001 ETH → 0.027104 USDG (fee 500, ts 10, pool `0x387b…5982`) ≈ ETH $2,710 — sane. PR08 builder semantics map directly (native ETH currency0, hookless, exact-in single pool, same router). |
| Look-alike tokens | NOTE | Every DexScreener "USDG/ETH" pool checked used a look-alike "USDG" (wrong address/decimals); a "HOOD/ETH" pool is GreenHood, not the stock token. **Execution must pin token addresses, never symbols.** Hooked pools (e.g. HOODEX) are refused by PR08 by design. |
| Mainnet V4 **execution** | BLOCKED | Disabled in code. Needs explicit approval + controlled mainnet canary. |
| Live autonomous trading in daemon | BLOCKED | Daemon is paper-only for Robinhood by design. |
| Lighter **testnet** | READY | Account 282, API key idx 2 registered, order create → open orders → cancel. |
| Lighter **mainnet** (read-only) | READY (read-only) | API `https://api.rh.lighter.xyz`, `/info` rollup `0x94bA…fF9d` (proxy, code present; EIP-1967 impl `0x82DE…1d90` contains `deposit(address,uint16,uint8,uint256)` selector `0x8a857083`). Collateral **USDG** asset id 3, l1 `0x5fc5…d168`, 6 decimals, margin enabled, min transfer/withdraw 1 USDG (matches first-party deposit docs: minimum 1 USDG, route 0 = perps). Agent wallet has no mainnet account (expected). |
| Lighter mainnet signing domain | UNVERIFIED | Robinhood-Lighter docs: 466324 (used by our config). Official lighter-go WASM's built-in default is 304 (original Lighter). Only an accepted mainnet tx can prove it. |
| Lighter mainnet onboarding | BLOCKED | Every step below is state-changing → explicit approval required. |
| House status panel | READY (truthful) | `sniper_state` belongs to the retired Solana house engine (nothing writes it since PR09A; there is no active Robinhood house engine). Panel now labels it "Solana house engine · retired" / "Last recorded P&L · Solana (historical)"; SOL kept, never shown as ETH. |
| Alpha main table | READY (pipeline) / UNVERIFIED (data) | Default tab is now the active **Robinhood** feed: GMGN Robinhood discovery + security + the daemon's `evaluateRobinhoodSafety` with the house config, read-only, cached, fail-closed. Live: GMGN answered, newest launches evaluated, **0 passed** the house checks in the window → no rows yet. Solana archive kept on its own tab. |
| Perpspad launch | BLOCKED (product) | Paused; copy now says the product is undecided (PERPSPAD_DECISION.md: UNRESOLVED). No new product work. |
| Historical Solana reads | READY | Unchanged. |

## Bot `Mordzz` (read at time of audit)
Running (`active: true`), **paper** mode, agent chain `robinhood` / network `testnet`,
agent `0xA81dc33B806739091384c41CB961e68448B6d531`, Lighter testnet account 282.
No real-money path is enabled (paper mode; mainnet refused everywhere). Left unchanged —
operator to confirm the Running state was intended.

## Secrets / environment
All values live in `.env.local` (gitignored); none printed or committed. The dev
database is a hosted Supabase Postgres — **if production points at the same
database, the same ciphertexts are shared.**

| Secret | Class | Notes |
|---|---|---|
| `AGENT_WALLET_ENCRYPTION_KEY` | PRODUCTION-REQUIRED · **MUST-PRESERVE-FOR-EXISTING-CIPHERTEXT** | Decrypts the 1 stored agent key (Mordzz). Changing it makes that agent wallet (and any funds in it) unusable. |
| `LIGHTER_API_KEY_ENCRYPTION_KEY` | PRODUCTION-REQUIRED · **MUST-PRESERVE-FOR-EXISTING-CIPHERTEXT** | Decrypts the 1 stored Lighter API key; blob is AAD-bound to network/account/key index. Changing it orphans the registered key (would need explicit rotation). |
| `PRIVY_APP_SECRET` | PRODUCTION-REQUIRED · ROTATABLE | Encrypts nothing; can be rotated in the Privy dashboard any time (the session created `…L5Cd`; old `…oCyG` still valid — consider deleting one). |
| `ROBINHOOD_TESTNET_CANARY_ENCRYPTION_KEY` | DEV-ONLY · MUST-PRESERVE (local canary file only) | Only encrypts `data/robinhood-testnet-canary.wallet.json`; never needed in production. |
| `HOUSE_ADMIN_WALLETS` | PRODUCTION-REQUIRED (config, not secret) | Empty = nobody. Needs operator input. |

**Re-encryption plan (not executed — needs approval):** if production must use
new encryption keys while sharing this database, do NOT just swap the env value.
Instead: (1) add `*_ENCRYPTION_KEY_NEXT`; (2) a one-off migration, in a
transaction, decrypts each ciphertext with the current key and re-encrypts with
the next key (Lighter blobs re-encrypted inside the signer worker, same AAD);
(3) verify every row decrypts + derived agent address / registered Lighter public
key still matches; (4) switch env, keep the old key offline until verified.
Alternatively, give production its own database and keep dev rows (testnet) out.

## Future mainnet onboarding (every step = explicit approval)
**Robinhood V4:** approve → mainnet execution config from `ROBINHOOD_MAINNET_V4_VERIFIED`
→ tiny mainnet canary (hookless ETH/USDG pool, pinned addresses) → verify receipts.

**Lighter:** agent wallet holds USDG → `approve(rollup, amount)` on USDG →
`deposit(agent, 3 /*USDG*/, 0 /*perps*/, amount ≥ 1 USDG)` → account appears
via `accountsByL1Address(agent)` → API-key registration (ChangePubKey, agent
EIP-191 L1Sig, domain to be confirmed) → minimum order → cancel.

## Still BLOCKED
Mainnet V4 execution · daemon live trading · Lighter mainnet onboarding ·
`HOUSE_ADMIN_WALLETS` (operator input) · Perpspad product · production key /
database separation decision.
