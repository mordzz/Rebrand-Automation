# Robinhood Chain Swap Execution Audit (PR08, audit-only)

Date: 2026-09-30
Scope: read-only research into how Noah would execute ETH↔ERC-20 swaps on
Robinhood Chain **testnet** (chain id 46630). No swap, signing, or
state-changing transaction was performed. No runtime code was added.

## 1. Executive summary

**REVISED 2026-09-30 (hardening pass).** The original audit concluded "no
AMM exists on testnet." That was **too broad and is corrected here**:
Uniswap **v4** core contracts (PoolManager, PositionManager, Quoter,
StateView) ARE deployed on Robinhood testnet with real bytecode, and this
audit found **real, actively-initialized pools with non-zero liquidity**,
including pools paired against testnet WETH. Uniswap **v2 and v3** remain
confirmed absent on testnet (empty bytecode at every official mainnet
address). The precise, evidence-supported conclusion is:

**`NO_VERIFIED_UNISWAP_V2_V3_SWAP_VENUE_ON_TESTNET`, but `Uniswap v4 core
infrastructure IS deployed and actively used on testnet, including
WETH-paired pools with real liquidity.`**

Overall provider status remains **`EXECUTION_PROVIDER_UNRESOLVED`** — not
because no venue exists, but because no venue has yet been verified against
this audit's full evidence bar (verified contracts + real liquidity +
working quote path + working router path + confirmed pons compatibility).
V4 clears the first two bars; the router-wiring and pons-compatibility bars
remain open — see §4b/§16.

**What changed from the original pass:**

- Uniswap v2 (`Factory`, `V2Router02`): confirmed **NO CODE** on testnet —
  original conclusion stands, now explicitly checked (was previously
  inferred, not directly tested).
- Uniswap v4 (`PoolManager`, `PositionManager`, `Quoter`, `StateView`):
  **all four have real, non-trivial bytecode on testnet.** This directly
  contradicts the original "no AMM on testnet" framing and is the single
  most important correction in this pass.
- A live `eth_getLogs` scan of `PoolManager`'s `Initialize` event (bounded
  to the most recent 8,000,000 blocks — see §4b for why a full historical
  scan isn't feasible on this RPC) found **8,982 pool-initialization
  events**, of which **49 involve testnet WETH** as one side of the pair.
  One WETH pool was independently confirmed via `StateView.getLiquidity()`
  to hold real, non-zero liquidity (`28,827,723,878,388,956,017,854` units)
  and a real, non-zero `sqrtPriceX96`/`tick` via `getSlot0()`.
- `UniversalRouter` (original mainnet address) still has bytecode on
  testnet, as found previously. Uniswap's own hosted API/frontend uses a
  **different, newer** address, "Universal Router 2.1.2"
  (`0x204FAca1764B154221e35c0d20aBb3c525710498`) on mainnet — that specific
  address has **NO CODE on testnet**, confirmed both on-chain and by
  Uniswap's own supported-chains documentation (§6).
- The pons-token question is narrowed per the task's instruction: this
  audit did **not** prove no pons launch has ever existed on testnet — it
  only re-confirmed that the *specific sample addresses* this repo
  previously documented are mainnet-only. See §5 revision below.

**What is still true and unchanged:** testnet has a real, verified WETH9
contract, a fully responsive public RPC for every read/estimate method
tested, and the transaction-construction/quote/approval/receipt design in
this document remains valid and directly reusable — now with a
substantially better on-chain foundation (a real, liquid V4 pool) to build
against, once the remaining open items (§16, §17) are resolved.

## 2. Sources

Priority order, per task instructions:

1. Uniswap official blog — [Uniswap is Live on Robinhood Chain](https://blog.uniswap.org/robinhood-chain-is-live)
2. Uniswap official developer docs — [Robinhood Chain Deployments (v3)](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments)
3. Robinhood official docs — [Protocol Contracts](https://docs.robinhood.com/chain/protocol-contracts/)
4. Direct on-chain verification (this audit): `eth_getCode`, `eth_chainId`, `eth_getTransactionCount`, `eth_estimateGas`, `eth_getLogs`, `symbol()`/`decimals()` reads against both `https://rpc.mainnet.chain.robinhood.com` and `https://rpc.testnet.chain.robinhood.com`, via viem, from inside this repo's own dev container
5. This repo's own prior live-verified findings — `GMGN_ROBINHOOD_FIELD_MAP.md` (pool/token addresses re-checked in this audit)
6. Uniswap official developer docs — [Supported Chains (Swapping API)](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains) — confirms 4663 listed, 46630 absent, and the "Universal Router 2.1.2" address used by the hosted API
7. Secondary/corroborating, NOT treated as authoritative on their own:
   - [dwellir.com — What Is Robinhood Chain?](https://www.dwellir.com/blog/what-is-robinhood-chain) (testnet launch date, chain id)
   - GitHub PR note (rainlanguage/sushiswap, awizardxch/Spellbook) — third-party observation that Uniswap's/0x's trading APIs explicitly refuse Robinhood testnet requests ("does not serve") — corroborates, does not by itself prove, the on-chain finding above
   - Search-result mentions of "Hoodex" / "Loxley" as testnet-native DEX projects — **unverified**, re-investigated in this pass (§4c), still no official documentation or on-chain confirmation found; not used as evidence for any conclusion below

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

**`NO_VERIFIED_UNISWAP_V3_SWAP_VENUE_ON_TESTNET`** (v3-specific — see §4d
for the corrected, broader picture once v4 is included)

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

`Permit2`'s presence is explained by it being a canonical, chain-agnostic
CREATE2 deployment used on dozens of EVM chains regardless of whether any
particular DEX is deployed there. **For v3 specifically**, `UniversalRouter`
has nothing to route through: the v3 Factory and every v3 pool-dependent
contract (Quoter, SwapRouter02, NonfungiblePositionManager) are absent, so
a v3-flavored swap through this router on testnet is not possible.

**Correction from the original audit pass:** it is NOT correct to
generalize this to "`UniversalRouter` cannot swap on testnet" — that claim
was too broad. `UniversalRouter` is a multi-protocol router whose usable
routes depend on which protocol commands it's configured for and which of
those protocols actually have deployed, initialized pools behind them. As
§4d establishes, Uniswap **v4** core infrastructure — a different pool
system from the v3 Factory this router lacks here — is genuinely deployed
and has real, liquid pools on testnet. Whether `UniversalRouter`'s v4
command path is actually wired to route through that testnet `PoolManager`
was not verified in this audit (see §16/§17) — but it is not ruled out
either, and should not have been implied to be ruled out by the v3-only
finding in this section.

Corroborating third-party evidence for v3/hosted-API specifically (not
authoritative alone, but consistent): a public GitHub PR (rainlanguage/
sushiswap tooling) notes that Robinhood testnet (46630) "is still refused
at request time with 'does not serve'" by Uniswap's and 0x's own trading
APIs — i.e. even the API layer that fronts the mainnet deployment
explicitly does not support testnet. This is evidence about the **hosted
API/frontend**, not proof that no on-chain AMM of any kind is deployed —
see §6.

Official Uniswap v3 deployments docs list **no testnet addresses at all**
— that specific page covers chain 4663 only. (Uniswap does document v4
testnet-adjacent infrastructure differently — see §4d.)

### 4c. Uniswap v2 — TESTNET (chain 46630)

Official mainnet v2 addresses (task-supplied, corroborated by the same
class of source as v3):

| Contract | Mainnet address | Testnet bytecode |
|---|---|---|
| Factory | `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f` | **NO CODE** |
| V2Router02 | `0x89e5db8b5aa49aa85ac63f691524311aeb649eba` | **NO CODE** |

Both confirmed empty via direct `eth_getCode` against the testnet RPC.
**`NO_VERIFIED_UNISWAP_V2_SWAP_VENUE_ON_TESTNET`** — this specific
conclusion stands, and unlike the original audit pass, it is now the
product of a direct check rather than an inference carried over from the
v3 finding.

### 4d. Uniswap v4 — TESTNET (chain 46630) — CORRECTED FINDING

Official mainnet v4 addresses (task-supplied):

| Contract | Address | Testnet bytecode |
|---|---|---|
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | **present — 48,020 bytes** |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` | **present — 47,756 bytes** |
| Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | **present — 12,238 bytes** |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | **present — 7,064 bytes** |
| UniversalRouter | `0x8876789976decbfcbbbe364623c63652db8c0904` | present — 49,094 bytes (identical to mainnet; same address already noted for v3) |
| Universal Router 2.1.2 | `0x204FAca1764B154221e35c0d20aBb3c525710498` | **NO CODE** |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | present — 18,306 bytes (identical to mainnet) |

**This is a real, non-trivial, functioning-shaped deployment** — these
bytecode sizes are consistent with genuine v4 core contracts, not stub or
placeholder code, and are corroborated by the pool activity found below.

**Pool activity (read-only `eth_getLogs` on `PoolManager`'s `Initialize`
event):**

The public testnet RPC is **not an archive node** — `eth_getCode`/state
queries at arbitrary historical block heights fail with "historical state
... is not available", and an unbounded `eth_getLogs` from block 0 times
out server-side ("log query timed out"). This bounds what a full-history
scan can prove: this audit could not scan from genesis, and a full
from-inception picture of pool creation is `INSUFFICIENT_EVIDENCE`, not
established either way. Bounded, working scans were performed instead:

| Window (most recent N blocks) | Total `Initialize` events | Unique WETH-paired pools |
|---|---|---|
| 10,000 | 3 | not separately counted |
| 100,000 | 25 | not separately counted |
| 1,000,000 | 212 | not separately counted |
| 3,000,000 | 2,031 | 11 |
| 8,000,000 | 8,982 | 49 |

(Testnet's current block height is ~126.6 million; an 8,000,000-block
window covers roughly the most recent ~6% of chain history and was the
largest window this audit could query without hitting the RPC's timeout.)

One WETH-paired pool was independently verified in full:

- Pool ID: `0x28ea2541ad0802c4303c96ea88f8d28f48473a08fceeafee6a8c201752dca2f8`
- `currency0`: `0x4AC7609512baF4bc88BC1D35a8483be52E08D271` (symbol `NEONTR`, confirmed via `symbol()`)
- `currency1`: `0x7943e237c7F95DA44E0301572D358911207852Fa` (testnet WETH)
- `fee`: `0` (static field — non-zero `hooks` address below means the
  effective fee is very likely hook-controlled/dynamic, not literally
  zero; this audit did not decode the hook contract's logic)
- `tickSpacing`: `200`
- `hooks`: `0xf2FA76cc1466b0a59209e4D5f9087EFb6c726acc` (a hook contract is
  attached — this is **not** a vanilla, hookless pool, which adds
  execution complexity: a real swap against it must account for whatever
  the hook does, not just standard V4 AMM math)
- `StateView.getSlot0(poolId)`: `sqrtPriceX96 = 2173610576973822006512262`, `tick = -210085`, `protocolFee = 0`, `lpFee = 0`
- `StateView.getLiquidity(poolId)`: `28827723878388956017854` (real, non-zero)
- Initialized at block `126309939`, tx `0xc91c1f24f27a2be29cea202e7303ee2847f5cd8c05eaeee656e1d16bca8798cd`

**Conclusion for v4:** a real, initialized, liquid pool involving testnet
WETH exists on Robinhood testnet today. This directly falsifies the
original audit's blanket "no AMM on testnet" framing. What remains
unverified (see §16/§17): whether `UniversalRouter` at the address present
on testnet is actually wired to route through this `PoolManager` instance
for a V4 command (this audit did not attempt a swap simulation through the
router — only confirmed the underlying pool state directly via
`StateView`, and confirmed the `Quoter` contract has real bytecode without
exercising it against this specific hooked pool), and whether this or any
other WETH pool involves a token that was ever discovered through GMGN's
`pons` feed (unverifiable from this environment — see §5).

### 4e. Other candidate testnet DEXes — re-investigated, still unverified

**Hoodex:** described in multiple search results as "the first DEX native
to Robinhood Chain for tokenized US equity spot swaps and perps," built
with Solidity and Chainlink oracles. No official website, no official
GitHub repository, and no contract address was found in this pass either.
Every source repeats the same marketing description without a verifiable
technical reference. **`INSUFFICIENT_EVIDENCE`** — unchanged from the
original audit.

**Loxley:** this pass found the name is **ambiguous/collides across
unrelated projects** — search results surfaced at least two different
GitHub repositories both named "loxley" with materially different
descriptions (one described as "the x402 rail for Robinhood Chain" for
USDG payments, another as "the exit desk for Robinhood Chain"), neither
matching the "flagship DEX" description used in the original audit and
the task's own framing. A specific repository path attributed to Loxley by
the search tool's own summary text did **not** actually appear in the raw
search results list — that attribution is unconfirmed and is explicitly
**not** repeated here as fact, per the task's instruction not to trust
AI-summary claims. No official docs, no verified contract address, no
on-chain confirmation. **`INSUFFICIENT_EVIDENCE`** — if anything, weaker
evidence than the original pass, once the name-collision problem is
accounted for.

**No other currently-documented Robinhood testnet DEX was found** in this
pass beyond Hoodex and Loxley (both unverified) and the Uniswap
deployments already covered in §4a–§4d.

## 5. Testnet vs. mainnet — explicit separation

| | Mainnet (4663) | Testnet (46630) |
|---|---|---|
| Uniswap v2 core deployed | not checked in this audit (out of scope for mainnet) | **No**, verified on-chain (empty bytecode) |
| Uniswap v3 core deployed | **Yes**, verified on-chain | **No**, verified on-chain (empty bytecode) |
| Uniswap v4 core deployed | not checked in this audit (out of scope for mainnet) | **Yes**, verified on-chain — real bytecode for PoolManager/PositionManager/Quoter/StateView, plus real `Initialize` events and a confirmed liquid WETH pool |
| Permit2 / UniversalRouter present | Yes | Yes (chain-agnostic deployments; UniversalRouter's v3 routes are unusable, v4 routing not verified) |
| WETH contract | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (verified — matches this repo's existing mainnet WETH usage) | `0x7943e237c7F95DA44E0301572D358911207852Fa` (verified on-chain: real bytecode, `symbol()` returns `WETH`, `decimals()` returns `18`, and participates in at least 49 initialized v4 pools within the last 8M blocks) |
| Pons pools/tokens observed | Yes (real, live, by prior PR05/PR06 investigation) | `NO_TESTNET_PONS_ACTIVITY_VERIFIED` — the specific sample pool/token addresses this repo previously documented are mainnet-only; whether any *other* pons launch has ever occurred on testnet is genuinely unresolved (see §17) |
| Public RPC read/estimate methods | not re-tested (out of scope; mainnet is informational only here) | Verified working: `eth_chainId`, `eth_getCode`, `eth_call`, `eth_getTransactionCount`, `eth_estimateGas`, `eth_getLogs` (non-archive: historical state/full-history logs beyond a bounded recent window are not servable — see §4d) |

**No mainnet activation, and no mainnet transaction, occurred or is
proposed by this audit.** Mainnet facts above are recorded strictly for
comparison, per the task's own instructions.

**Revised gap statement:** mainnet has a real, verified Uniswap v3
deployment with real pons liquidity. Testnet does **not** have a verified
v2 or v3 deployment, but **does** have a real, actively-used v4
deployment with real WETH-paired liquidity — the original blanket "testnet
has neither" statement was incorrect and is retracted. What remains
genuinely open is (a) whether that v4 liquidity is reachable through a
working router/quote path, and (b) whether any pons-launched token
specifically has ever traded on testnet at all — see §16/§17.

## 6. Quote mechanism

**Revised.** The original conclusion ("no quote mechanism is viable,
because there is no deployed AMM") no longer holds in general — a real,
liquid v4 pool exists (§4d). Re-evaluated per-option:

| Option | Status on Robinhood testnet |
|---|---|
| A. On-chain Quoter/QuoterV2 (v3) | **Unusable for v3** — v3 QuoterV2 has no bytecode on testnet. **v4's `Quoter` contract DOES have real bytecode on testnet** (12,238 bytes) — this audit confirmed its deployment but did not exercise it with a live `quoteExactInputSingle`-equivalent `eth_call` against the confirmed WETH pool (the pool's non-zero `hooks` address means a naive quote call may need hook-aware calldata this audit did not construct) — `UNRESOLVED`, not `Unusable` |
| B. Direct pool simulation/read | **Usable for v4** — `StateView.getSlot0()`/`getLiquidity()` were successfully read for a real pool in this audit (§4d); this is itself a form of option B and is the strongest-evidence path found so far, though it gives pool state, not a computed swap quote |
| C. DEX/aggregator HTTP quote API | **Unusable for testnet** — corroborating evidence (§4b, §6-Uniswap-API) that Uniswap's/0x's own trading APIs refuse Robinhood testnet requests; unaffected by the v4 finding, since this is about the hosted API layer, not the chain itself |
| D. Router-specific quote endpoint | Same as C for any hosted endpoint. Unverified for an on-chain router-integrated quote path (e.g. via `UniversalRouter`) — not attempted in this pass |

**Revised status: partially viable, not fully verified.** Option B (direct
`StateView` reads) is proven to work today against a real pool. Option A
for v4 specifically is a strong candidate — the `Quoter` contract exists —
but was not exercised end-to-end in this pass and should not yet be
called "usable" without that follow-up `eth_call`. The task's stated
preference (a deterministic, independently-verifiable on-chain read path)
is now concretely closer to available than the original pass found, via
v4's `StateView`/`Quoter`, not v3's `QuoterV2`.

### 6a. Uniswap hosted API/frontend chain support

Verified against Uniswap's own [Supported Chains documentation](https://developers.uniswap.org/docs/trading/swapping-api/supported-chains):

- Robinhood **mainnet, chain `4663`**, is listed as a supported mainnet
  chain, with "Universal Router 2.1.2" at
  `0x204FAca1764B154221e35c0d20aBb3c525710498` as the address the hosted
  API/frontend uses there.
- Robinhood **testnet, chain `46630`, does not appear anywhere** in that
  documentation's testnet-chains list (which currently covers only
  Unichain Sepolia, Base Sepolia, and Ethereum Sepolia).
- This "Universal Router 2.1.2" address was independently confirmed via
  `eth_getCode` to have **NO CODE on Robinhood testnet** — consistent with
  it simply never having been deployed there, not merely being
  unsupported by the API layer.

**This is evidence about Uniswap's hosted API/interface product, not
proof that no on-chain AMM of any kind exists on testnet** — per the
task's explicit instruction, API absence alone is not treated as proof of
on-chain absence. In this case the two happen to agree for v3 (no API
support, no on-chain deployment) but diverge for v4 (no API support, yet
genuine on-chain deployment with real liquidity — §4d). The hosted API's
chain list should not be used as a stand-in for on-chain verification
going forward.

## 7. ETH/WETH handling (design, pending a real venue)

Verified testnet WETH: `0x7943e237c7F95DA44E0301572D358911207852Fa` — real
bytecode (4,406 bytes, a WETH9-sized contract), `symbol()` → `"WETH"`,
`decimals()` → `18`. Standard WETH9 semantics (`deposit()` payable,
`withdraw(uint256)`, ERC-20 interface) can be assumed for a canonical WETH9
contract of this shape, but the exact deposit/withdraw function selectors
were not individually round-trip-tested in this audit (no state-changing
call was made, per task constraints) — flagged as `UNRESOLVED` pending a
non-persistent `eth_call` simulation against the `deposit()`/`withdraw()`
selectors in a future, still read-only, verification pass. Note the
precise terminology: `eth_call` can simulate a state-changing (non-`view`)
function without persisting any state change to the chain, but that is not
strictly the same guarantee as Solidity's `STATICCALL` opcode (which
reverts if the callee itself attempts a state-changing operation) —
`eth_call`'s simulation succeeds even for functions that mutate state,
because the node discards the resulting state changes after computing the
call's return value/gas, rather than rejecting the call for attempting
them.

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
| `eth_getLogs` | OK (queried WETH's Transfer logs over the last 100 blocks; later reused successfully at much larger scale — up to an 8,000,000-block window — for `PoolManager`'s `Initialize` events, §4d) |

**No paid RPC provider is required for the read/estimate side of PR08.**
The RPC itself is healthy and fully responsive for every method tested.

**New limitation found in this pass: the public RPC is not an archive
node.** `eth_getCode` (and by extension any state read) at an arbitrary
historical block height fails with `"historical state ... is not
available"`, and an unbounded `eth_getLogs` from genesis times out
server-side (`"log query timed out"`). Bounded, recent-window queries
(tested up to 8,000,000 blocks, out of a current chain height of ~126.6
million) work reliably. This means: this audit **cannot** rule out pool
activity, deployments, or events older than the RPC's retention window —
any "not found" conclusion in this document that relies on `eth_getLogs`
is scoped to the window actually queried, not to the chain's full
history. A paid archive-node provider would be needed to remove this
specific limitation, though it is not needed for any of the read/estimate
calls PR08's adapter itself would make at swap time (those are always
against current/recent state).

## 15. Read-only live verification performed

All performed via `eth_getCode`, `eth_chainId`, `eth_call`,
`eth_getTransactionCount`, `eth_estimateGas`, `eth_getLogs`, and
`readContract` (view-function calls) — no state-changing call, no
approval, no swap, no signing, no ETH sent, no token transfer, no
contract deployed:

- confirmed both mainnet (4663) and testnet (46630) RPC endpoints respond
  with their correct respective chain IDs
- confirmed bytecode presence/absence for 8 Uniswap v3 contracts on both
  networks (§4a/§4b)
- confirmed bytecode absence for both Uniswap v2 contracts on testnet (§4c)
- confirmed bytecode **presence** for all 4 Uniswap v4 core contracts on
  testnet, plus `UniversalRouter` and `Permit2` (§4d)
- confirmed a previously-documented real pons pool and its token exist on
  mainnet (44,286 and 10,514 bytes of bytecode respectively) and do **not**
  exist on testnet (the specific sample addresses only — see §17 for the
  scope of this claim)
- confirmed testnet WETH's bytecode, `symbol()`, and `decimals()`
- confirmed `eth_getTransactionCount`, `eth_estimateGas`, and `eth_getLogs`
  all function against the testnet public RPC
- **new in this pass:** scanned `PoolManager`'s `Initialize` event over
  bounded recent windows up to 8,000,000 blocks, finding 8,982 pool
  initializations and 49 unique WETH-paired pools
- **new in this pass:** read `StateView.getSlot0()` and
  `StateView.getLiquidity()` for one specific WETH-paired pool, confirming
  real, non-zero liquidity and price state
- **new in this pass:** confirmed the "Universal Router 2.1.2" address
  used by Uniswap's hosted API has no bytecode on testnet

## 16. Provider comparison

| Provider/route | Testnet support verified? | Deployment confirmed? | Quote mechanism | Router/calldata available | API key required | Pons-compatible on testnet | Complexity | Unresolved risk |
|---|---|---|---|---|---|---|---|---|
| Uniswap v2 | **No** | No — empty bytecode on testnet | N/A | N/A | N/A | No | N/A | Blocked entirely on deployment gap |
| Uniswap v3 (SwapRouter02) | **No** | No — empty bytecode on testnet | N/A | N/A | N/A | No | N/A | Blocked entirely on deployment gap |
| **Uniswap v4** (PoolManager/Quoter/StateView) | **Yes — core contracts deployed with real bytecode** | **Yes — real, initialized, liquid WETH pool confirmed on-chain** | `StateView` reads confirmed working; `Quoter` deployed but not exercised end-to-end | `UniversalRouter` has bytecode on testnet, but its wiring to this `PoolManager` for a v4 swap command was **not verified** | No (public RPC sufficient for all reads performed) | **Unverified** — the confirmed pool pairs WETH with `NEONTR`, not a token this audit can confirm was ever discovered via GMGN's `pons` feed | Elevated — the confirmed pool uses a custom hook contract (non-zero `hooks` address), meaning standard vanilla-V4 swap math may not directly apply | Router/quote path not proven end-to-end; hook behavior unknown; pons-compatibility unverified; full pool history unknown (non-archive RPC) |
| Uniswap trading API / 0x API | No | N/A (API layer, not on-chain) | Would be HTTP quote | Possibly, but unverified | Likely yes | No | N/A | Third-party evidence + Uniswap's own supported-chains docs agree: testnet is not supported by the hosted API |
| "Hoodex" (community-referenced testnet DEX) | Unverified | Unverified | Unverified | Unverified | Unverified | Unknown | Unknown | `INSUFFICIENT_EVIDENCE` — no official docs, GitHub, or on-chain check found in either audit pass |
| "Loxley" (community-referenced testnet DEX) | Unverified | Unverified | Unverified | Unverified | Unverified | Unknown | Unknown | `INSUFFICIENT_EVIDENCE` — name collides across unrelated projects; no single authoritative deployment identified |

**`EXECUTION_PROVIDER_UNRESOLVED`** — Uniswap v4 is the only candidate with
verified testnet deployment AND verified real liquidity, clearing two of
the four evidence-bar requirements (§8 of the task: verified contracts,
real liquidity, quote path, router path). It has **not** cleared the
quote-path (not exercised end-to-end) or router-path (wiring unverified)
bars, and pons-compatibility is unverified for any candidate. Per the
task's explicit instruction, this status means **"no execution venue
satisfying the full evidence bar has been verified" — not "no execution
venue exists."** Uniswap v4 is the clear front-runner for follow-up
verification work, not a rejected candidate.

## 17. Unresolved questions

- `NO_VERIFIED_UNISWAP_V2_V3_SWAP_VENUE_ON_TESTNET` — confirmed for v2 and
  v3 specifically; **not** a claim that no AMM of any kind exists on
  testnet (v4 is confirmed deployed and active — §4d)
- `NO_TESTNET_PONS_ACTIVITY_VERIFIED` — **precise scope of this claim**:
  - **OBSERVED**: the specific sample pons pool and token addresses this
    repo previously documented (from mainnet investigation) return empty
    bytecode on testnet.
  - **UNRESOLVED**: whether GMGN exposes any testnet-specific or
    network-scoped view of `pons` (or any other launchpad) activity. This
    audit did **not** invent or test a hypothetical GMGN network
    parameter, per the task's explicit instruction. This codebase's
    existing GMGN integration (`lib/gmgn/discovery-robinhood.ts` and
    related) calls `chain=robinhood` with no separate network selector,
    and all of this project's prior live-verified GMGN payloads have been
    mainnet data — but this audit did not exhaustively prove GMGN could
    never surface testnet-specific results under some other call shape.
  - **UNRESOLVED**: whether any pons-branded (or any other) launch has
    ever occurred anywhere on Robinhood testnet, independent of GMGN —
    this audit's on-chain search was scoped to Uniswap v2/v3/v4 core
    contracts and one specific WETH pool's pair (`NEONTR`), not a
    general-purpose scan for pons-style launch transactions.
- WETH `deposit()`/`withdraw()` selectors not individually round-trip
  verified (only `symbol()`/`decimals()` and raw bytecode presence)
- Router-level ETH-handling semantics for v4 specifically (native-ETH
  accepted directly by `UniversalRouter`'s v4 commands vs. wrap-first,
  hook-aware calldata requirements) — `UNRESOLVED`, not exercised in this
  pass
- Whether `UniversalRouter` (the testnet-present address) is actually
  configured/wired to route through the confirmed testnet `PoolManager` —
  `UNRESOLVED`, no swap or quote simulation was attempted through the
  router in this pass
- The confirmed WETH pool's hook contract (`0xf2FA76cc...`) behavior is
  entirely unexamined — `UNRESOLVED`; a "dynamic fee" or other custom hook
  logic could materially change execution semantics versus a vanilla pool
- Fee-on-transfer/tax-token router compatibility — `UNRESOLVED`, depends
  on whichever router/version PR08 eventually targets
- Full historical pool-creation picture beyond the most recent ~6% of
  chain history (8,000,000 of ~126,600,000 blocks) — `INSUFFICIENT_EVIDENCE`,
  the public RPC is not an archive node and could not serve a full-history
  scan (§14)
- "Hoodex" — `INSUFFICIENT_EVIDENCE`, no official docs/GitHub/on-chain
  evidence found in either audit pass
- "Loxley" — `INSUFFICIENT_EVIDENCE`, name collides across at least two
  unrelated GitHub projects; no single authoritative deployment identified

## 18. Proposed PR08 implementation boundary (not yet started)

Uniswap v4 on testnet is the leading candidate to build this against, once
its remaining open items are closed (§16/§17: end-to-end quote
verification, router-wiring confirmation, hook-behavior review, and —
separately — actual pons-token compatibility, which is unresolved for
every candidate including v4). Once a real, verified venue is confirmed
usable for the specific tokens PR08 needs to trade:

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
