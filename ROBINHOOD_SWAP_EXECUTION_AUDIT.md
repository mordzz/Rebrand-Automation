# Robinhood Chain Swap Execution Audit (PR08, audit-only)

Date: 2026-09-30
Scope: read-only research into how Noah would execute ETH↔ERC-20 swaps on
Robinhood Chain **testnet** (chain id 46630). No swap, signing, or
state-changing transaction was performed. No runtime code was added.

## 1. Executive summary

**`UNISWAP_TESTNET_DEPLOYMENT_NOT_VERIFIED`**

Uniswap v2/v3/v4/UniswapX are confirmed live on Robinhood Chain **mainnet**
(chain 4663) via Uniswap's own blog and official deployments docs. Direct
on-chain verification in this audit (`eth_getCode` against the testnet RPC)
confirms the Uniswap v3 **core AMM contracts do not exist on testnet**:
Factory, QuoterV2, SwapRouter02, NonfungiblePositionManager,
UniswapInterfaceMulticall, and TickLens all return empty bytecode at their
official mainnet addresses when queried on testnet (chain 46630). Only
`Permit2` and `UniversalRouter` have bytecode on testnet, and this is
explained by both being deployed via chain-agnostic deterministic (CREATE2)
factories used across many EVM chains — their presence does **not** imply a
working swap venue, since `UniversalRouter` has nothing to route through
without a Factory/pools behind it.

Separately, and just as importantly: the `pons`-launched tokens and pools
this codebase has been discovering and safety-checking since PR05/PR06
were re-verified in this audit and **only exist on Robinhood mainnet**.
The specific pool and token addresses previously used as reference examples
(`GMGN_ROBINHOOD_FIELD_MAP.md`) return empty bytecode on testnet. No pons
(or any GMGN-discovered) pool or token was found to exist on testnet during
this audit.

**Net conclusion: there is currently no verified, usable execution venue on
Robinhood testnet for tokens discovered through GMGN's `pons` allow-list.**
PR08 cannot yet implement a testnet swap against real pons-launched tokens,
because those tokens/pools do not exist on testnet. This is reported as a
gap, not papered over — see §17.

What testnet *does* have, verified on-chain: a real WETH9-style contract
(symbol `WETH`, 18 decimals, real bytecode) and a fully responsive public
RPC supporting every read/estimate method this audit checked. The
transaction-construction, quote-mechanism, approval-model, and
receipt-verification design work in this document is still valid and
directly reusable the moment a real testnet AMM deployment (Uniswap or
otherwise) is confirmed, or once pons activity appears on testnet, or once
mainnet-with-real-funds is authorized as a later, separate decision.

## 2. Sources

Priority order, per task instructions:

1. Uniswap official blog — [Uniswap is Live on Robinhood Chain](https://blog.uniswap.org/robinhood-chain-is-live)
2. Uniswap official developer docs — [Robinhood Chain Deployments (v3)](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments)
3. Robinhood official docs — [Protocol Contracts](https://docs.robinhood.com/chain/protocol-contracts/)
4. Direct on-chain verification (this audit): `eth_getCode`, `eth_chainId`, `eth_getTransactionCount`, `eth_estimateGas`, `eth_getLogs`, `symbol()`/`decimals()` reads against both `https://rpc.mainnet.chain.robinhood.com` and `https://rpc.testnet.chain.robinhood.com`, via viem, from inside this repo's own dev container
5. This repo's own prior live-verified findings — `GMGN_ROBINHOOD_FIELD_MAP.md` (pool/token addresses re-checked in this audit)
6. Secondary/corroborating, NOT treated as authoritative on their own:
   - [dwellir.com — What Is Robinhood Chain?](https://www.dwellir.com/blog/what-is-robinhood-chain) (testnet launch date, chain id)
   - GitHub PR note (rainlanguage/sushiswap, awizardxch/Spellbook) — third-party observation that Uniswap's/0x's trading APIs explicitly refuse Robinhood testnet requests ("does not serve") — corroborates, does not by itself prove, the on-chain finding above
   - Search-result mentions of "Hoodex" / "Loxley" as testnet-native DEX projects — **unverified**, no official documentation or on-chain confirmation performed in this audit; not used as evidence for any conclusion below

No blog post, AI summary, or unverified label was treated as authoritative
on its own — every address-level claim below is either from Robinhood's or
Uniswap's own official documentation, or independently confirmed on-chain
in this audit (or both).

## 3. Testnet network facts (verified)

| Fact | Value | Verification |
|---|---|---|
| Chain ID | `46630` | `eth_chainId` via viem `getChainId()` — confirmed live |
| RPC | `https://rpc.testnet.chain.robinhood.com` | used for every check in this audit |
| Explorer | `https://explorer.testnet.chain.robinhood.com` | not scraped in this audit; not needed given on-chain confirmation |
| Native gas asset | ETH (no market value on testnet) | per Robinhood/community docs; consistent with `lib/chain/config.ts`'s existing `ROBINHOOD_NATIVE_SYMBOL` |
| Architecture | Arbitrum Orbit L2, settles to Ethereum Sepolia | Robinhood/Uniswap docs |
| Launch date | 2026-02-10 | secondary source (dwellir), not independently re-verified — not load-bearing for this audit's conclusions |

## 4. Discovered DEX deployments

### 4a. Uniswap v3 — MAINNET (chain 4663), informational only

Source: [Uniswap's official v3 deployments doc](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments), independently confirmed on-chain (`eth_getCode` returns real, non-trivial bytecode for every address below, on mainnet):

| Contract | Address (mainnet, chain 4663) | Bytecode confirmed |
|---|---|---|
| UniswapV3Factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | yes (49,072 bytes) |
| SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` | yes (48,996 bytes) |
| QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` | yes (16,548 bytes) |
| UniversalRouter | `0x8876789976decbfcbbbe364623c63652db8c0904` | yes (49,094 bytes) |
| NonfungiblePositionManager | `0x73991a25c818bf1f1128deaab1492d45638de0d3` | yes (48,770 bytes) |
| UniswapInterfaceMulticall | `0x282a3c4d320cc7f0d5eaf56b8029e4b88338f0a3` | yes (2,768 bytes) |
| TickLens | `0x7dfd4f31be6814d2906bde155c3e1b146eac1468` | yes (2,772 bytes) |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | yes (18,306 bytes) |

`UniswapV3Factory` at `0x1f7d7550...` matches exactly the address this
repo's own PR06.5 investigation already found and documented in
`GMGN_ROBINHOOD_FIELD_MAP.md` — cross-confirms both findings.

**This is mainnet only. No mainnet activation is proposed or implied by
listing this table** — it is recorded for completeness and for the future
PR08 decision, per §5.

### 4b. Uniswap v3 — TESTNET (chain 46630)

**`UNISWAP_TESTNET_DEPLOYMENT_NOT_VERIFIED`**

The same 8 addresses above were queried on testnet via `eth_getCode`:

| Contract | Testnet bytecode |
|---|---|
| UniswapV3Factory | **NO CODE** |
| SwapRouter02 | **NO CODE** |
| QuoterV2 | **NO CODE** |
| NonfungiblePositionManager | **NO CODE** |
| UniswapInterfaceMulticall | **NO CODE** |
| TickLens | **NO CODE** |
| UniversalRouter | code present (49,094 bytes — identical size to mainnet) |
| Permit2 | code present (18,306 bytes — identical to mainnet) |

`Permit2` and `UniversalRouter` being present is explained by both being
canonical, chain-agnostic CREATE2 deployments used on dozens of EVM chains
regardless of whether Uniswap's own AMM is deployed there — their presence
is **not evidence of a working Uniswap venue on testnet**. `UniversalRouter`
with no Factory/pools behind it cannot execute a swap.

Corroborating third-party evidence (not authoritative alone, but
consistent): a public GitHub PR (rainlanguage/sushiswap tooling) notes that
Robinhood testnet (46630) "is still refused at request time with 'does not
serve'" by Uniswap's and 0x's own trading APIs — i.e. even the API layer
that fronts the mainnet deployment explicitly does not support testnet.

Official Uniswap docs list **no testnet addresses at all** — the deployments
page covers chain 4663 only.

### 4c. Other candidate testnet DEXes — not verified

Search results surfaced community/hackathon references to projects named
"Hoodex" and "Loxley" described as testnet-native DEXes for Robinhood
Chain. **No official documentation, verified contract address, or on-chain
confirmation was performed for either in this audit.** Per the task's
evidence bar, these are recorded as leads only, not conclusions:
`INSUFFICIENT_EVIDENCE`. If PR08 is to proceed against a non-Uniswap
testnet venue, evaluating one of these (or a fresh search closer to
implementation time, since testnet ecosystems change quickly) is separate
follow-up work, not concluded here.

## 5. Testnet vs. mainnet — explicit separation

| | Mainnet (4663) | Testnet (46630) |
|---|---|---|
| Uniswap v3 core deployed | **Yes**, verified on-chain | **No**, verified on-chain (empty bytecode) |
| Permit2 / UniversalRouter present | Yes | Yes (but non-functional alone, no Factory) |
| WETH contract | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (verified — matches this repo's existing mainnet WETH usage) | `0x7943e237c7F95DA44E0301572D358911207852Fa` (verified on-chain: real bytecode, `symbol()` returns `WETH`, `decimals()` returns `18`) |
| Pons pools/tokens observed | Yes (real, live, by prior PR05/PR06 investigation) | **No** — the specific pool/token addresses this repo previously documented return empty bytecode on testnet |
| Public RPC read/estimate methods | not re-tested (out of scope; mainnet is informational only here) | Verified working: `eth_chainId`, `eth_getCode`, `eth_call`, `eth_getTransactionCount`, `eth_estimateGas`, `eth_getLogs` |

**No mainnet activation, and no mainnet transaction, occurred or is
proposed by this audit.** Mainnet facts above are recorded strictly for
comparison, per the task's own instructions.

**Explicit gap statement (per §5 of the task):** mainnet has a real,
verified Uniswap v3 deployment with real pons liquidity; testnet has
neither. PR08 as originally scoped ("swap testnet tokens discovered via
GMGN pons") cannot be implemented against testnet today, because the
tokens it would need to trade don't exist there.

## 6. Quote mechanism

Evaluated against the options listed in the task:

| Option | Status on Robinhood testnet |
|---|---|
| A. On-chain Quoter/QuoterV2 | **Unusable** — QuoterV2 contract has no bytecode on testnet |
| B. Direct pool simulation/read | **Unusable** — no pons (or any) pool exists on testnet to read |
| C. DEX/aggregator HTTP quote API | **Unusable for testnet** — corroborating evidence (§4b) that Uniswap's/0x's own trading APIs refuse Robinhood testnet requests |
| D. Router-specific quote endpoint | Same as C — no known working endpoint for testnet |

None of the four quote-mechanism options are currently viable against
Robinhood testnet, because there is no deployed AMM to quote against.
**This entire section is blocked on §5's gap**, not on a design choice.
The preference stated in the task (a deterministic, independently-verifiable
on-chain read path, i.e. option A) remains the right target architecture
for whenever a real testnet AMM exists — QuoterV2's `quoteExactInputSingle`
(a static/non-mutating call, safe to simulate via `eth_call`) is the
correct primitive to design PR08's `quoteSwap()` around, once there's a
deployed Quoter to call.

## 7. ETH/WETH handling (design, pending a real venue)

Verified testnet WETH: `0x7943e237c7F95DA44E0301572D358911207852Fa` — real
bytecode (4,406 bytes, a WETH9-sized contract), `symbol()` → `"WETH"`,
`decimals()` → `18`. Standard WETH9 semantics (`deposit()` payable,
`withdraw(uint256)`, ERC-20 interface) can be assumed for a canonical WETH9
contract of this shape, but the exact deposit/withdraw function selectors
were not individually round-trip-tested in this audit (no state-changing
call was made, per task constraints) — flagged as `UNRESOLVED` pending a
`eth_call` against `deposit()`/`withdraw()` selectors (a `staticcall`-safe
check that doesn't require holding a balance) in a future, still read-only,
verification pass.

Router-level ETH semantics (native ETH accepted directly vs. wrap-first,
`multicall`/`refundETH` requirement, Universal Router's command-based
model vs. classic `exactInputSingle`) are all **Uniswap SwapRouter02 /
UniversalRouter behaviors that cannot be verified on testnet, because
neither contract's swap-capable form exists there** (UniversalRouter's
bytecode is present but has no pools to route through). This is recorded
as `UNRESOLVED — blocked on §5`, not assumed from Ethereum-mainnet Uniswap
documentation, per the task's explicit instruction not to infer from
Ethereum/Arbitrum defaults.

## 8. ERC-20 approval / Permit2

`Permit2` (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) is confirmed
deployed with identical bytecode on both mainnet and testnet — this is
expected, since Permit2 is a universal CREATE2 deployment independent of
any particular DEX being live on a chain. Its **presence on testnet does
not mean it is usable for a real swap flow there**, since the router it
would authorize (UniversalRouter, non-functional without pools) has
nothing to execute.

Design guidance for whenever a real venue exists (Uniswap SwapRouter02 or
UniversalRouter, per whichever mainnet uses): prefer the **minimum safe
approval** — an exact-amount `approve(spender, amount)` per trade (or a
Permit2 signed transfer of the exact trade amount), never an unlimited
`approve(spender, type(uint256).max)`. This audit does not implement
either; it is recorded as the intended PR08 design constraint per the
task's own instruction ("do not authorize unlimited approval by default").

## 9. Slippage / minimum-output mapping (design, pending a real venue)

Noah's existing conceptual shape (strategy/risk decides trade parameters;
execution adapter receives token/side/amount/slippage) maps directly onto
Uniswap v3's `exactInputSingle`/`exactInput` `amountOutMinimum` parameter,
or UniversalRouter's equivalent command parameters, **once a real Quoter
and pool exist to compute the quote `amountOutMinimum` is derived from**.
No slippage value, formula, or risk threshold was changed or proposed to
change in this audit, per the task's explicit instruction.

## 10. Token decimals / base units

Standard, chain-agnostic ERC-20 reads — no Robinhood-specific behavior
found or expected:

- `decimals()` → `uint8`
- `symbol()` → `string`
- `balanceOf(address)` → `uint256`
- `allowance(owner, spender)` → `uint256`

All amounts must be handled as integer base units (`bigint` in viem), never
floating point — this matches the existing pattern already used elsewhere
in this codebase (e.g. `lib/sniper/market-cap.ts`'s mint-supply/decimals
handling for Solana). No implementation was added in this audit.

## 11. Unsigned transaction design (interface only, not implemented)

Per the task's required PR08/PR09 boundary, the following adapter shape is
proposed as a design target — **no code was written for this**:

```
quoteSwap(input) -> { amountOut, route, priceImpact? }        // read-only, eth_call
buildSwapTransaction(input) -> { to, data, value }             // unsigned calldata only
checkAllowance(owner, token, spender) -> bigint                // read-only
buildApprovalTransaction(token, spender, amount) -> { to, data } // unsigned calldata only
interpretSwapReceipt(receipt) -> { success, amountIn, amountOut, reason? }
```

None of these functions sign, hold, or touch a private key. PR08's
boundary ends at producing `{ to, data, value }` unsigned transaction
objects and interpreting a receipt after some other component (PR09)
broadcasts them. PR09 owns account/nonce/signing/sending — strictly out of
scope here, and nothing in this audit crosses that line.

## 12. Receipt / revert handling (design, pending a real venue)

Minimum verification checklist for PR08 (to be implemented later, once a
real venue exists):

- receipt exists at all (not `null`/pending forever)
- `receipt.status === "success"`, not `"reverted"`
- `receipt.chainId` (or the client's own configured chain) matches the
  intended network — never trust an ambiguous/cross-chain receipt
- the transaction's `to` matches the expected router address
- decode Transfer logs to recover actual amount in/out (never trust the
  pre-trade quote as the realized fill — same principle this repo's
  existing Solana `fillPriceSol()` already applies)
- explicit handling for: reverted call, RPC unavailable/timeout, still
  pending, and a dropped/replaced transaction (same nonce reused) —
  **never mark a trade successful merely because `eth_sendRawTransaction`
  returned a hash**, per the task's explicit instruction

## 13. Fee-on-transfer / tax tokens (execution-layer implications only)

PR06 safety already evaluates honeypot/tax signals from GMGN; this audit
does not add or change any safety rule. For the execution layer
specifically (once a real venue exists):

- a fee-on-transfer token silently reduces the actual amount received
  below what a naive quote implies — Uniswap's `exactInputSingle` computes
  `amountOutMinimum` from the router's own internal accounting and does
  **not** natively support fee-on-transfer output tokens without using the
  `*SupportingFeeOnTransferTokens` router variants (a v2-era concept; v3
  routers historically do not offer an equivalent, since v3 pools account
  reserves differently) — this needs its own focused check against
  whichever router/version PR08 eventually targets, flagged `UNRESOLVED`
- if the router doesn't support fee-on-transfer tokens, execution against
  one would either revert (safe, loud failure) or under-fill against
  `amountOutMinimum` and revert on the slippage check (still safe) —
  **not implemented, not further speculated on here**

## 14. RPC requirements — testnet public RPC viability

All methods checked against the public testnet RPC
(`https://rpc.testnet.chain.robinhood.com`), no paid provider used:

| Method | Result |
|---|---|
| `eth_chainId` | OK — returns `46630` |
| `eth_getCode` | OK — used extensively throughout this audit |
| `eth_call` (`symbol`, `decimals`) | OK |
| `eth_getTransactionCount` | OK (once the queried address is properly EIP-55 checksummed — an unchecksummed/malformed address is correctly rejected as an invalid parameter, not a method-support gap) |
| `eth_estimateGas` | OK (simulated a real WETH `deposit()` call, no transaction sent) |
| `eth_getLogs` | OK (queried WETH's Transfer logs over the last 100 blocks) |

**No paid RPC provider is required for the read/estimate side of PR08.**
This conclusion is unaffected by the deployment gap in §5 — the RPC itself
is healthy and fully responsive; there is simply no AMM deployed there yet
to query.

## 15. Read-only live verification performed

All performed via `eth_getCode`, `eth_chainId`, `eth_call`,
`eth_getTransactionCount`, `eth_estimateGas`, `eth_getLogs` — no
state-changing call, no approval, no swap, no signing, no ETH sent, no
token transfer, no contract deployed:

- confirmed both mainnet (4663) and testnet (46630) RPC endpoints respond
  with their correct respective chain IDs
- confirmed bytecode presence/absence for 8 Uniswap v3 contracts on both
  networks (§4a/§4b)
- confirmed a previously-documented real pons pool and its token exist on
  mainnet (44,286 and 10,514 bytes of bytecode respectively) and do **not**
  exist on testnet
- confirmed testnet WETH's bytecode, `symbol()`, and `decimals()`
- confirmed `eth_getTransactionCount`, `eth_estimateGas`, and `eth_getLogs`
  all function against the testnet public RPC

## 16. Provider comparison

| Provider/route | Testnet support verified? | Deployment confirmed? | Quote mechanism | Router/calldata available | API key required | Pons-compatible on testnet | Complexity | Unresolved risk |
|---|---|---|---|---|---|---|---|---|
| Uniswap v3 (SwapRouter02/UniversalRouter) | **No** | No — empty bytecode on testnet | N/A | N/A | N/A | No (no pons pools exist on testnet) | N/A | Blocked entirely on deployment gap |
| Uniswap trading API / 0x API | No | N/A (API layer, not on-chain) | Would be HTTP quote | Possibly, but unverified | Likely yes | No | N/A | Third-party evidence says testnet requests are explicitly refused |
| "Hoodex" / "Loxley" (community-referenced testnet DEXes) | Unverified | Unverified | Unverified | Unverified | Unverified | Unknown | Unknown | `INSUFFICIENT_EVIDENCE` — no official docs or on-chain check performed |

**`EXECUTION_PROVIDER_UNRESOLVED`** — no candidate currently has both (a)
verified testnet deployment and (b) verified pons-token compatibility.
Evidence does not clearly demonstrate any provider can execute the
required testnet swaps today.

## 17. Unresolved questions

- `UNISWAP_TESTNET_DEPLOYMENT_NOT_VERIFIED` (core finding — see §1, §4b)
- No pons pool or token found to exist on Robinhood testnet in this audit
  (checked against the specific previously-documented mainnet examples;
  a broader testnet-wide pons discovery sweep via GMGN with a
  testnet-scoped query was not performed in this audit and is itself
  `INSUFFICIENT_EVIDENCE` — GMGN's `chain=robinhood` parameter does not
  appear to expose a network selector distinguishing testnet from mainnet
  in the endpoints this codebase already uses; this should be explicitly
  re-checked before concluding testnet pons activity can never exist)
- WETH `deposit()`/`withdraw()` selectors not individually round-trip
  verified (only `symbol()`/`decimals()` and raw bytecode presence)
- Router-level ETH-handling semantics (native-ETH-accepting vs.
  wrap-first, multicall/refundETH, exactInputSingle vs. Universal Router
  command model) — `UNRESOLVED`, cannot be verified without a deployed,
  swap-capable router on testnet
- Fee-on-transfer/tax-token router compatibility — `UNRESOLVED`, depends
  on whichever router version is eventually targeted
- "Hoodex" and "Loxley" — `INSUFFICIENT_EVIDENCE`, not verified at all in
  this audit

## 18. Proposed PR08 implementation boundary (not yet started)

Once a real, verified testnet (or explicitly-authorized mainnet) AMM
deployment exists for pons-launched tokens:

- `quoteSwap()` — read-only `eth_call` against a real Quoter contract
- `buildSwapTransaction()` — unsigned `{ to, data, value }` construction
  against the verified router, honoring the existing Noah slippage value
  as `amountOutMinimum`
- `checkAllowance()` / `buildApprovalTransaction()` — minimum-necessary,
  exact-amount approval (or Permit2 signed transfer), never unlimited
- `interpretSwapReceipt()` — full success/revert/log-decoding semantics
  per §12

PR08 produces unsigned transaction data and quote/receipt logic only. It
does not hold, generate, or use a private key at any point.

## 19. PR09 boundary (explicitly out of scope, not started)

Account management, nonce handling, transaction signing, and broadcasting
are exclusively PR09's responsibility. Nothing in this audit or in the
proposed PR08 interface (§11, §18) crosses into that territory. No
autonomous EVM key was created, requested, or referenced anywhere in this
audit.
