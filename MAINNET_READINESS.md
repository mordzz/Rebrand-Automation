# Robinhood Testnet Acceptance & Mainnet Handoff

Branch `feat/robinhood`. Updated 2026-10-01.

> # MAINNET IS DEFERRED TO BANG REY
> This project's acceptance scope is **Robinhood Chain TESTNET (46630) + Lighter
> TESTNET** only. Nothing here declares mainnet ready. Every mainnet
> state-changing path is **disabled in code** and **no mainnet transaction has
> ever been sent**. Mainnet notes at the bottom are **handoff evidence only —
> NOT ACCEPTED, NOT LIVE-TESTED**.

## Testnet acceptance (in scope)

| Capability | Status | Evidence |
|---|---|---|
| Robinhood SPOT execution (testnet) | ACCEPTED | PR10 live canary on 46630 with the isolated canary wallet: quote → build → sign EIP-1559 → validate → broadcast → receipt; BUY `0x295ec2c8…3227`, rebroadcast of the same signed BUY = no-op, ERC-20 approval `0x7bb87df3…d6d7`, Permit2 `0xbe221873…823d`, SELL `0x3aedbcc1…acb9`. Spot execution code unchanged since (only unused mainnet handoff constants were added) → regression tests suffice. |
| Lighter PERPS (testnet) | ACCEPTED | Agent-wallet-owned account 282, API key index 2 (encrypted, worker-only). Original acceptance: order create → open orders → cancel. **Re-accepted after the signer re-pin** (WASM `411a3280…`): auth token, account read, order `562949952968426` (create tx `9aa0d8c6…`, cancel tx `168f03b8…`), cancel verified, 0 open positions, collateral unchanged. |
| Ownership model | ACCEPTED | Privy user wallet owns the bot; Noah agent wallet `0xA81d…d531` owns the Lighter account; Lighter API key is only the delegated routine signer. |
| GMGN (Robinhood discovery/data) | CONNECTED | `chain=robinhood` discovery, security, rank, KOL / smart-money. Rate limits (429) and zero passing candidates are not blockers. |
| Noah workflow | UNCHANGED | Discovery → safety → strategy → risk → BUY/REFUSE → position mgmt → SELL → PnL → post-mortem → lessons. Thresholds untouched. |
| Alpha | ACCEPTED | Active tab = Robinhood feed (house safety checks, read-only, fail-closed). Solana archive on its own tab. Zero passes is acceptable; filters not weakened. |
| Historical Solana data | TRUTHFUL | Historical rows keep SOL / Solana explorer links; retired Solana house engine state labeled as such, never shown as ETH. |
| House dashboard actions | ACCEPTED | Require a verified signed-in Privy session (no anonymous access). No `HOUSE_ADMIN_WALLETS`, no admin role. |
| Perpspad | PAUSED / UNRESOLVED | No new launch product. |
| Deployment build | See report | Docker builds the official lighter-go signer (pinned commit, `-buildvcs=false`, SHA-256 checked). |

### Bot `Mordzz`
Robinhood **testnet**, **paper** mode, observed Running; agent `0xA81dc33B806739091384c41CB961e68448B6d531`;
Lighter testnet account 282. Not changed by this work.

### Secrets
`AGENT_WALLET_ENCRYPTION_KEY` and `LIGHTER_API_KEY_ENCRYPTION_KEY` decrypt stored
ciphertext — **preserve, never rotate/regenerate**. `ROBINHOOD_TESTNET_CANARY_ENCRYPTION_KEY`
is testnet-canary-only. `PRIVY_APP_SECRET` is rotatable. Production keys/database
separation → **Bang Rey**.

## Mainnet — DEFERRED TO BANG REY (handoff notes only)

Status of every mainnet item: **DEFERRED TO BANG REY · NOT ACCEPTED · NOT LIVE-TESTED ·
STATE-CHANGING PATH DISABLED.** Refusal is proven offline by `npm run test:mainnet-guards`
(no mainnet RPC/API call).

| Item | Handoff note (collected earlier, read-only; not re-verified) |
|---|---|
| Robinhood mainnet v4 contracts | Uniswap v4 deployments page lists "Robinhood Chain: 4663". Earlier read-only checks saw code at PoolManager `0x8366…0951`, Quoter `0x8dc1…8f94`, StateView `0xf333…673b`, PositionManager `0x58da…a7`, UniversalRouter `0x8876…0904` (+ 2.1.2 `0x204F…0498`), Permit2 `0x0000…8BA3`; WETH `0x0Bd7…AD73`, USDG `0x5fc5…d168`. Kept in `ROBINHOOD_MAINNET_V4_VERIFIED` as **unused data** — not executable. A docs-PR router `0x06afBA43…F99` was not wired to the PoolManager → do not use. |
| Mainnet quote | One read-only Quoter `eth_call` on a hookless ETH/USDG pool looked sane. Handoff only. |
| Token warning | Many "USDG"/"HOOD" pools on DexScreener are look-alikes → pin addresses, never symbols. |
| Lighter mainnet | API `api.rh.lighter.xyz`, rollup `0x94bA…fF9d`, USDG collateral (6 dp, min 1), documented `deposit(address,uint16,uint8,uint256)`. |
| Lighter mainnet signing domain | **Unresolved → Bang Rey** (docs 466324 vs lighter-go default 304). |
| Production secrets / database | **Bang Rey.** |
| Mainnet canary / onboarding / live daemon | **Bang Rey**, explicit approval required. |
