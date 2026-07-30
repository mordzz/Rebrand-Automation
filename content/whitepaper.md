# Noah Engine
### A Public Fleet of Autonomous Trading Agents on Solana

**Technical Whitepaper · v1.0-rc**

| | |
|---|---|
| **Status** | Release candidate, pending legal review and the open items in Appendix D |
| **Date** | ⟦FILL: publication date⟧ |
| **Site** | noah-engine.fly.dev |
| **Source** | ⟦FILL: repository URL, or state that source is closed⟧ |
| **Contact** | ⟦FILL: official contact⟧ |

---

**Notation.** Fields marked `⟦FILL: …⟧` are values this document cannot assert until measured, decided, or reviewed. They are listed in full in **Appendix D**. Nothing in this document reports observed performance; where a figure would normally appear, the field is marked rather than estimated. This is deliberate: a whitepaper that invents its own evidence is worth less than one that admits what it has not yet measured.

---

> **Read this first.** Noah Engine is trading software. It is not a fund, not a broker, and not a promise. It does not guarantee profit and it can lose money, including all of it. Memecoin trading is among the highest-risk activities in crypto. Nothing here is financial advice. See §22.

---

## 1. Abstract

Noah Engine is a platform for deploying autonomous trading agents onto Solana memecoin markets.

An operator names an agent, sets the limits it must obey, and deploys it. From that point the agent runs continuously: reading the mint stream, refusing almost everything it sees, sizing the few survivors against a fixed risk budget, and exiting on rules established before the position existed. When it loses, it writes down why.

Every agent joins a public fleet. Anyone can watch agents refuse tokens and file post-mortems in real time. The fleet is **not ranked by profit**. It is ranked by survival, because a ranking by profit rewards whoever took the largest position on the luckiest day and teaches every newcomer to do the same.

This document specifies the mechanisms rather than the intentions: the tiered safety gate and its latency budget (§9), the shared verdict model that makes one gate serve an entire fleet (§8.2), the idempotency protocol that prevents duplicate fills (§11.2), continuous post-entry re-verification (§9.5), state reconstruction after restart (§11.4), and the honest limits of stop-loss execution on an AMM (§12).

---

## 2. Definitions

**Noah Engine.** The platform: mint feed, safety gate, execution infrastructure, post-mortem analysis, fleet directory.

**A Noah Agent.** One deployed instance belonging to one operator, with its own name, configuration, wallet binding, memory, and history.

**The Fleet.** The public population of deployed agents.

**Operator.** The human who owns an agent and its capital.

**Stopped.** An agent whose operator has switched it off, or whose circuit breaker has tripped. It opens nothing; existing positions are still watched and exited by their own rules.

---

## 3. Why "Noah"

Solana produces a flood of new tokens daily. The overwhelming majority are worthless and a meaningful share are constructed to take your money. Finding tokens was never the problem; the problem is that almost everything must be turned away.

Noah is named for the discipline of the ark: build the hull first, fix the admission criteria before the water rises, let almost nothing aboard. An agent that buys enthusiastically is trivial to write. An agent that refuses correctly, thousands of times a day, is the hard part, and it is the part that determines whether a wallet survives.

The metaphor also settles the question every trading platform eventually faces: *what counts as winning?* An ark is not judged by how much it collected, but by whether it was still afloat when the water went down.

---

## 4. Problem Statement

**Markets never close.** Launches cluster unpredictably across all 24 hours.

**The window is minutes.** By the time a token reaches a call channel, the price discovery it describes has already occurred.

**A large share of tokens are adversarial by construction.** Honeypots, freeze-authority traps, live mint authority, Token-2022 extension traps, bundled supply, and instant liquidity pulls are a standing fraction of daily launches.

**Automation fails worse than humans fail.** A person who misjudges one token loses one position. A misconfigured agent repeats that judgment a hundred times before anyone notices. The risk layer therefore has authority over the entry layer, enforced by pipeline ordering rather than by policy (§10).

**Existing tools teach the wrong lesson.** Bot products advertise their best trades; trading competitions rank by return. Both train operators toward maximum risk, because maximum risk is what tops a profit ranking. The operator who survives a year is invisible in that world.

---

## 5. Design Principles

1. **Refuse by default.** A token must affirmatively pass every applicable check. Missing or unreadable data is failure, never a pass.
2. **Rules before positions.** Stop, targets, and size are fixed at entry and enforced mechanically.
3. **Paper first.** Every agent begins in dry-run. Going live is an explicit, separate decision.
4. **Operator limits are hard limits.** No component may exceed the configured position size, concurrency cap, or daily loss limit, including under retry, restart, or partial failure.
5. **Rank survival, never profit.** Every public metric is chosen so the behavior it rewards is behavior worth copying.
6. **No model in the trade path.** Language models perform post-hoc analysis only (§13.2).
7. **Auditable behavior.** Every decision, including every refusal, is logged with its reason and the on-chain data behind it.
8. **No performance claims.** Methodology and outcomes are published; projections are not.

---

## 6. Threat Model

Noah defends against these adversaries. Anything outside this list is out of scope and should be assumed undefended.

| Adversary | Capability | Primary defense |
|---|---|---|
| Token deployer | Constructs traps in the token itself | Manifest, tiered (§9) |
| Token deployer | Changes conditions *after* entry | Continuous re-verification (§9.5) |
| Bundler | Conceals supply control behind apparent organic demand | Tier 2 cluster detection (§9.3) |
| Searcher / MEV bot | Reorders around agent transactions | Slippage bounds, ⟦FILL: MEV posture⟧ (§11.1) |
| Stop-hunter | Pushes spot price to trigger clustered exits | Multi-slot exit confirmation (§12.2) |
| Copycat operator | Replicates a successful configuration | Parameter opacity, forced diversity (§14.4) |
| Fleet gamer | Optimizes for rank rather than trading | Eligibility thresholds (§14.2) |
| Impersonator | Fraudulent agents, sites, or accounts | Naming controls, verification (§14.6) |
| External attacker | Compromises Noah infrastructure | Key isolation (§7.2), constrained vault (§7.1) |

**Explicitly out of scope:** compromise of the operator's own device or authentication; market-wide crashes; chain halts; and adversaries with the ability to reorder blocks at will.

---

## 7. Custody and Key Architecture

### 7.1 Custody model

Noah Agents trade while the operator is absent. That requires signing capability available without the operator present, which constrains the possible designs to three.

**Model A: External wallet, operator signs each trade.** Genuinely non-custodial, but incompatible with autonomous overnight execution.

**Model B: Delegated signing on an embedded wallet.** The operator grants Noah scoped, revocable permission to sign on their behalf. This achieves 24/7 execution, and under it Noah's infrastructure *can* sign for the operator. Any claim that Noah "only sees your public address" is incompatible with this model and must not be made.

**Model C: On-chain constrained vault.** The operator deposits into a program-derived account they own. The agent key is a delegate authorized to invoke whitelisted swap programs only, and **cannot transfer to any destination except the owner's wallet**, enforced by program logic, not by policy. Under Model C, full compromise of Noah's infrastructure allows an attacker to make bad trades, not to steal funds.

**Model D: dedicated agent wallet, funded by deposit.** This is what Noah Engine implements today. Deploying an agent generates a fresh Solana keypair belonging to that agent alone. The operator's own wallet, which they connect to sign in, is used only to establish who owns the agent, and its keys are never requested, held, or delegated. To let the agent trade, the operator deposits SOL into the agent wallet. They may withdraw the balance to any address at any time, and may export the agent's private key to import it into a wallet of their own.

Model D is not a substitute for Model C, and the distinction is the one that matters to a reader deciding whether to fund an agent:

- **What is bounded:** only the balance the operator chooses to deposit is ever at risk. There is no path from an agent wallet to the operator's own wallet, because Noah never holds authority over the latter.
- **What is not bounded:** Noah holds the agent wallet's key material and can therefore sign anything that key can sign, including a transfer out. Nothing in program logic prevents this. The constraint is operational, not cryptographic, and it must be read that way. Any claim that funds in an agent wallet "cannot be taken" would be false.
- **What the operator retains:** the key is exportable, so an operator is never locked into Noah's custody of it.

Model C remains the recommended target architecture. It is the only model in which "your funds cannot be taken" survives an adversarial reading, and it is the only one coherent with a product whose entire thesis is constraint. Migrating from Model D to Model C is on the roadmap (§21) and is not yet built.

Because Model D is what ships, the honest instruction to operators is the one stated in §16.4: deposit only what you are prepared to lose outright, independently of trading outcome.

**Absolute rule, independent of model:** Noah never requests or accepts a private key or seed phrase, in any interface, under any encryption story. Any site or account that does is fraudulent.

### 7.2 Key isolation under multi-tenancy

Under Models B and C, Noah holds delegated signing authority for many operators simultaneously. This is a distinct problem from the custody model and remains present in both.

What ships today, stated plainly rather than aspirationally:

- Each agent wallet's secret key is stored **encrypted at rest** with AES-256-GCM. The encryption key lives only in the process environment, never in the database, so a database dump on its own is not sufficient to move funds.
- The platform **refuses to create an agent wallet at all** when that encryption key is absent, rather than falling back to storing a key in plaintext.
- Authority is **per-agent**: one wallet, one key, one agent. There is no fleet-wide signing credential.
- No API returns the encrypted secret. Exporting a key requires a signature from the operator's own wallet, proving ownership; every other endpoint in the deploy surface trusts a client-asserted address, which is not sufficient for key material.
- The paper-trading process is structurally incapable of signing: it does not import any signing helper and does not read the house wallet key.

What does **not** ship yet, and should not be assumed:

- Keys are decrypted in application memory at signing time. There is no KMS, no HSM, and no separate minimally-scoped signing service. A sufficiently deep compromise of the application host reaches key material.
- Signature requests are not logged to an append-only store independent of the requesting service.
- The environment-held encryption key must be backed up separately from database backups. Losing it makes every agent wallet permanently unrecoverable.

Under Model C, an attacker who defeats all of the above can still only route funds back to operator wallets.

---

## 8. System Architecture

### 8.1 Pipeline

The Flood is two sources, not one. A push stream carries pump.fun mints within milliseconds of creation, and a polled feed covers every other indexed launchpad (bags, believe, letsbonk, boop, heaven, moonshot, meteora and others) at a few seconds' latency. Both empty into the same Manifest, and a candidate carries which source found it.

They are not interchangeable, and the difference is a constraint rather than a detail. The polled feed arrives with market data already attached, so it can answer questions the push stream cannot, including holder concentration and honeypot signals. The push stream arrives sooner. An agent's entry filters are applied identically to both: a requirement an operator sets is enforced regardless of which source surfaced the token, including checks the feed itself does not provide, which are then performed directly against the chain.

```
                    THE FLOOD: Solana mint & pool stream
                                    │
                      ┌─────────────▼─────────────┐
                      │   MANIFEST: TIER 0        │  <10ms, zero extra RPC
                      │   authority & extensions  │
                      └─────────────┬─────────────┘
                      ┌─────────────▼─────────────┐
                      │   MANIFEST: TIER 1        │  ~50–150ms
                      │   liquidity, holders,     │
                      │   sell simulation         │
                      └─────────────┬─────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
┌───────▼────────┐        ┌─────────▼─────────┐                 │
│  RAVEN         │        │  MANIFEST TIER 2  │  seconds        │
│  Tier 0–1 only │        │  deployer history │                 │
│  reduced size  │        │  bundle detection │                 │
└───────┬────────┘        └─────────┬─────────┘                 │
        │                 ┌─────────▼─────────┐                 │
        │                 │  WAKE             │                 │
        │                 │  full gate, full  │                 │
        │                 │  size permitted   │                 │
        │                 └─────────┬─────────┘                 │
        └───────────┬───────────────┘                           │
                    │                                           │
          ┌─────────▼─────────┐                                 │
          │    THE TIDE       │  sizing, budget, veto           │
          └─────────┬─────────┘                                 │
          ┌─────────▼─────────┐                                 │
          │    EXECUTION      │  idempotent submission          │
          └─────────┬─────────┘                                 │
          ┌─────────▼─────────┐      ┌──────────────────────┐   │
          │    THE ARK        │◄─────┤  CONTINUOUS RE-VERIFY│◄──┘
          │  position guard   │      │  (§9.5)              │
          └─────────┬─────────┘      └──────────────────────┘
          ┌─────────▼─────────┐
          │   POST-MORTEM     │  out-of-band analysis
          └─────────┬─────────┘
          ┌─────────▼─────────┐
          │    THE FLEET      │  public survival record
          └───────────────────┘
```

Two properties of this ordering are load-bearing. First, safety precedes strategy: a token with live freeze authority is discarded before anything scores it. Second, **Tier 2 runs in parallel with Raven rather than blocking it**, which is what makes Raven's speed and the Manifest's depth compatible (§9).

### 8.2 The shared verdict model

A Manifest verdict is a property of a *token*, not of an operator. If three hundred agents observe the same mint, the gate must not run three hundred times.

- Verdicts are computed **once per token per tier** and published to all agents.
- Verdicts are cached with tier-specific TTLs, since conditions change: ⟦FILL: TTL per tier⟧.
- Cache entries are invalidated immediately on any observed change to the underlying accounts (liquidity events, authority changes, extension configuration).
- Per-agent computation is limited to sizing, budget checks, and strategy decisions, all cheap and all local to that agent.

This is what allows one safety gate to serve an arbitrarily large fleet at fixed cost, and it is why gate depth can be increased without degrading per-agent latency.

**A consequence that must be stated plainly:** because agents share one stream and one verdict, they observe the same candidates at the same instant. Crowding is therefore **structural, not incidental**, and is addressed in §14.4 rather than left to emerge.

### 8.3 Latency budget

The design constraint is that Tier 0 must complete within the same slot as pool creation, and Tier 1 within the following slot. See Appendix B for the full budget.

---

## 9. The Manifest

The Manifest is the safety gate and the most important component in the system. It is **tiered by data cost**, because depth and speed are not simultaneously available and pretending otherwise would be dishonest.

### 9.1 Tier 0: parsed from the observed transaction (<10ms, zero additional RPC)

Every field below is readable from the pool-creation transaction and mint account already present in the stream. No additional network round trip is required.

- **Mint authority** must be revoked; otherwise supply can be inflated at will
- **Freeze authority** must be revoked; otherwise the ability to sell can be switched off
- **Token-2022 extensions:**
  - Transfer hook present → reject (arbitrary code executes on transfer)
  - Permanent delegate present → reject (a third party can move holdings)
  - Non-transferable → reject
  - Transfer fee above threshold → reject
  - **Transfer fee config authority not revoked → reject.** Checking the current fee is insufficient; if the authority remains, the fee can be raised after entry.
- **Update authority** state recorded

### 9.2 Tier 1: bounded RPC (~50–150ms)

- Pool reserves and absolute liquidity minimum
- Reserve ratio sanity check against reported supply
- LP burn or lock status, with unlock timestamp **recorded for continuous monitoring** (§9.5)
- Top-10 holder concentration
- Deployer holdings
- **Sell simulation from the agent's actual wallet** at the intended position size
- Effective sell tax and round-trip slippage at target size

### 9.3 Tier 2: expensive, asynchronous (seconds)

Runs in parallel and never blocks Tier 0–1 consumers.

- Deployer transaction history: prior mints and their outcomes where resolvable
- Funding-graph analysis of early buyers
- Bundle detection: clusters of same-slot buys from funding-linked wallets

### 9.4 Fail-closed rule

If any applicable check cannot complete (RPC timeout, unparseable account, unrecognized extension, unknown program), the candidate is refused. Noah does not trade on incomplete information, and an unrecognized Token-2022 extension is treated as hostile rather than ignored.

### 9.5 Continuous re-verification

**A pre-trade gate is insufficient, because the risks it screens for do not stop existing after entry.** Every open position is re-verified on a ⟦FILL: interval⟧ cycle:

| Condition | Trigger | Response |
|---|---|---|
| Sell simulation now fails | Any cycle | **Emergency exit attempt, highest priority** |
| Effective sell tax increased | Any cycle | Immediate exit |
| LP unlock timestamp approaching | Recorded at Tier 1 | Forced exit before unlock window |
| Liquidity falls below floor | Any cycle | Immediate exit |
| Authority state changed | Any cycle | Immediate exit |

The first row closes the most dangerous gap in a single-pass gate: a **time-delayed honeypot**, where sells succeed for an initial window and are then disabled. Entry simulation passes; exit fails. Only repeated simulation detects it, and only detecting it early leaves any chance of exiting.

### 9.6 Limits of sell simulation

Sell simulation is the highest-value single check in the system, and it has three limits that must be stated:

1. It evaluates state at one slot. Passing at entry does not guarantee sellability at exit; hence §9.5.
2. It cannot detect time- or condition-gated restrictions that are not yet active.
3. Allowlist and blocklist mechanisms are wallet-specific, which is why simulation runs **from the agent's own wallet** and never from a shared probe address.

### 9.7 The refusal feed

Every rejection, from every agent, streams publicly with its reason and tier:

```
17:04:12  T0  Sisyphus     refused  4Hq2…  freeze authority active
17:04:12  T0  Little Boat  refused  4Hq2…  freeze authority active
17:04:19  T1  Sisyphus     refused  9Kp7…  top-10 holds 61%
17:04:23  T1  Driftwood    refused  Bn3x…  sell simulation failed
17:04:31  T2  Little Boat  refused  Cw8m…  deployer: 4 prior rugs
17:06:02  RV  Driftwood    exited   Ka4p…  sell simulation began failing
```

The feed is continuous, cannot be convincingly fabricated, and demonstrates the system's thesis without a marketing claim attached.

---

## 10. Instincts

An operator deploys one agent with three instincts: one that generates, two that constrain.

**The Raven: early entry.** The only instinct that opens a position. Acts on Tier 0 and Tier 1 verdicts, because nothing slower completes inside the window a fresh mint gives you.

**The Ark: position guardian.** Opens nothing. Arms breakeven once a position is meaningfully green, tightens exits as momentum decays, and exits on stall, drawdown, or crash.

**The Tide: session authority.** Sizing against the risk budget, enforcement of every operator limit, the daily loss limit that ends a session, and the cadence that turns post-mortems into reviewable configuration changes.

**The Raven generates. Ark and Tide constrain. In every conflict, the constraining instincts win.** An entry signal cannot override a risk limit, not as a toggle but as a property of pipeline ordering. An operator's configuration governs how aggressively Raven may act; it cannot disable Ark or Tide.

**On a second entry instinct.** Earlier drafts described a slower, confirmation-based entry alongside the Raven, permitted a larger position because it acted on more complete information. It has been removed rather than deferred. Two reasons, and the second is the real one. It depended on a Tier 2 verdict arriving before entry, which the latency budget does not allow (§8.3). And a second entry strategy doubles the surface that has to be validated while the first one still has no live track record at all. A platform whose thesis is restraint should not ship a second way to buy before it can show the first one works.

---

## 11. Execution

### 11.1 Submission

- **Routing** via Jupiter's swap API. A quote is taken first, and the position is recorded only after the swap confirms, using the transaction signature as the position's identity, so a failed submission can never leave a ledger entry for a fill that did not happen. A candidate with no route is skipped, not forced.
- **Slippage bounds** are hard limits; a fill outside tolerance is abandoned, never chased. Today the tolerance passed to the router is derived from the agent's configured stop distance, on the reasoning that a fill worse than the stop is a fill not worth having.
- **Priority fees** derived from recent slot congestion, capped by operator configuration
- **MEV posture: none, deliberately.** No bundle submission and no tips. A tip large enough to matter is a meaningful share of a position this size, so buying priority would cost more than the sandwiching it avoids. This is a consequence of small absolute position sizes and would have to be revisited if those grew.
- **Compute budget** tuned per instruction type to reduce failed-transaction waste

Failed transactions consume SOL. Each agent maintains a reserved fee balance and halts rather than draining it.

### 11.2 Idempotency and duplicate-fill prevention

Retrying a trade naively is the most dangerous bug available to this system: a transaction that landed but whose confirmation was not observed, retried, produces **two positions and a breach of the operator's size limit**, violating Design Principle 4 silently.

The protocol:

1. Every intent receives an **intent ID** before any transaction is constructed, persisted before submission.
2. Submissions carry a deterministic client reference tied to the intent ID, so any landed transaction is attributable to its intent.
3. **No retry occurs without on-chain reconciliation first.** Before resubmitting, the executor queries the agent's token account and recent signatures to determine whether the intent already landed.
4. Solana blockhashes expire in roughly 60 seconds. On expiry the intent is marked *indeterminate*, reconciled on-chain, and only then either retired or reissued under a new intent ID.
5. Jito bundles that fail to land produce no revert and no error, only silence. **Bundle submission therefore always requires positive on-chain confirmation**, never absence-of-error.
6. Reconciliation is authoritative. Where the database and the chain disagree, the chain wins and the database is corrected.

### 11.3 Confirmation

Every transaction is tracked to finality. States are explicit: `pending`, `landed`, `failed`, `expired`, `indeterminate`. No intent is ever considered resolved on inference.

### 11.4 State recovery after restart

If the Engine restarts holding open positions, agent state **must not** be trusted from the database alone: a database lagging the chain produces an agent that resumes unaware it holds an unguarded position.

On startup, for every agent:

1. Enumerate actual token balances on-chain.
2. Reconstruct entry basis from transaction history.
3. Reconcile against stored intents; log every discrepancy.
4. Re-run Tier 0–1 and sell simulation against every recovered position before resuming.
5. Re-arm stops and targets from stored configuration.
6. Resume normal operation only once every position is accounted for.

**Positions discovered on-chain but absent from stored state are adopted under the agent's current risk configuration, not ignored.** Published restart behavior is part of the operational contract (§18).

---

## 12. Exit Semantics

### 12.1 What a stop-loss is, and is not

**There are no stop orders on an AMM.** A "stop" is Noah observing price and submitting a sell. It is therefore best-effort, and it can fail to protect the operator when:

- The Engine is unavailable
- The chain is congested past the exit's fee ceiling
- Liquidity is removed within a single block
- Price gaps past the level between observations

Memecoins gap violently and single-block liquidity removal is common, so these are frequent events, not edge cases.

Noah therefore describes its exits as **rule-based automatic exits, executed best-effort**, never as guaranteed stops, and never as a floor on loss. Public copy claiming "hard stops" as a guarantee should be corrected, because the first operator to gap through one will be correct and public about it.

### 12.2 Price source and stop-hunt resistance

Exits triggered on a single spot observation are trivially induced: one large sell depresses the pool momentarily, every agent holding that token exits at the bottom, and price recovers. With a shared verdict stream and a shared price feed, this would hit the **entire fleet simultaneously**, turning a manipulation into a fleet-wide event.

Accordingly:

- Trigger price is derived from ⟦FILL: pool reserve-weighted price over N slots⟧, not a single tick
- Non-emergency exits require confirmation across ⟦FILL: N⟧ consecutive slots
- **Emergency exits (§9.5) bypass confirmation entirely**: when sell simulation begins failing, delay is the larger risk

---

## 13. The Post-Mortem Loop

### 13.1 Mechanism

1. On close, a losing position is packaged with full context: entry conditions, the Manifest verdict at every tier, execution quality against expectation, exit trigger, and the price path after exit.
2. The record is analyzed for proximate cause: poor fill, exit too tight, entry signal that did not hold, or a risk that passed the Manifest and should not have.
3. Causes that **recur above a repetition threshold** are surfaced as specific configuration proposals.
4. The operator reviews and accepts. **Lessons are never silently applied.**

Manifest failures identified this way feed back into gate rules for the whole fleet, not only the affected agent. This is the mechanism by which one operator's loss improves everyone's refusals.

### 13.2 Where the model sits, and does not

**No language model participates in any trading decision.** Model inference has latency measured in seconds; the trade path has a budget measured in milliseconds. The two are architecturally incompatible, and any product implying otherwise is describing something that cannot work at this speed.

Language models are used **out-of-band only**, for post-mortem analysis after a position has closed. Every entry, sizing, and exit decision is made by deterministic rules whose inputs are logged and reproducible.

Public copy should state this rather than leaning on "Powered by AI": the specific claim is both more credible and more accurate.

### 13.3 Memory growth

An agent's memory grows without bound while its analysis context does not. After several hundred trades, naive accumulation exceeds any practical context limit.

Memory is therefore structured rather than appended: individual post-mortems are retained in full and immutably, while analysis operates over ⟦FILL: retrieval or hierarchical summarization strategy⟧. The operator can always read the full record; the analyzer reads a bounded selection of it.

### 13.4 Honest limits

- **Small samples mislead.** A handful of losses in one regime can produce a "lesson" that is noise; hence repetition thresholds.
- **Recency bias is the natural failure mode.** A system tuned on recent losses drifts toward whatever avoided the last drawdown, which is not the same as whatever works.
- **Automated analysis can be confidently wrong.** Language models produce fluent causal accounts that are sometimes incorrect. Operator review is the safeguard.
- **Learning efficacy is unproven.** Whether accepted lessons measurably improve outcomes is an empirical question this project has not yet answered. Methodology: ⟦FILL: how lesson efficacy will be measured⟧.

---

## 14. The Fleet

### 14.1 What is public

Public: the refusal feed; each agent's name, face, and age; survival metrics; post-mortems where the operator permits; full position events for paper agents; live agent activity per §14.7.

Not public: operator identity, wallet balances, and **exact configuration parameters** (§14.4).

### 14.2 No leaderboard of any kind

**Noah has no profit leaderboard.** A profit ranking rewards whoever took the largest position on the luckiest day; every rational operator responds by maximizing risk, and the agents at the top become the most reckless in the fleet, precisely the behavior newcomers would then copy.

Earlier drafts answered this with a survival ranking: days afloat, refusal rate, stop discipline, capital retained, deepest drawdown, gated behind eligibility thresholds so that an agent which never trades could not top the fleet by doing nothing. That ranking has been removed, and this section now commits to the stronger position instead: **the fleet is a directory, not a competition.**

The reasoning is the one that made the eligibility thresholds necessary in the first place. Any ranking of a small population is mostly noise, and dressing noise in five metrics does not make it signal. The thresholds were an attempt to stop the ranking being gamed, which is an admission that the ranking creates a reason to game it. Removing the ranking removes the incentive at its source, and costs nothing a reader actually needs: an agent's own record is published in full, and a reader comparing two agents can do so directly.

What each agent publishes about itself:

| Shown | Why |
|---|---|
| Age since deploy | Whether a record is long enough to mean anything |
| Positions taken, and closed | The denominator for everything else |
| Realized result, paper or live, labelled | Never a ranking, and never comparable across different deposit sizes |
| Refusals, with reasons | The behavior the platform is actually claiming |
| Post-mortems where the operator permits | Whether it learns |
| Open positions | What it is exposed to now |

**A number without its denominator is not published.** A win rate over four trades is not a win rate, and an agent with too short a record shows its counts rather than a percentage.

### 14.3 No coordination: a permanent commitment

Agents are visible to each other. **They do not coordinate.**

Hundreds of agents entering a thin pool simultaneously is functionally indistinguishable from coordinated market manipulation, on a platform that built the mechanism and charges for access to it. Noah therefore commits permanently to:

- No agent-to-agent trade signalling
- No shared entry triggers or synchronized execution
- No feature whose effect is many agents entering the same token in the same window
- Treating emergent crowding as a defect to be engineered against (§14.4)

Agents share a **record**, not a strategy. What one agent learns is visible as a story, never transmitted as a signal.

### 14.4 Crowding and capacity

Because the fleet shares one stream and one verdict cache (§8.2), crowding is structural: as the live population grows, agents increasingly compete for the same fills.

Earlier drafts proposed to engineer around this with per-candidate participation limits, enforced parameter randomization within each operator's configured ranges, deliberate exit jitter, and a cap on live seats. **All of it is removed.** Each one improves an aggregate by quietly making an individual operator's agent worse than what they configured, and none of them is honest about doing so:

- A participation limit denies an agent an entry it qualified for, so that a different customer's agent can take it.
- Enforced randomization overrides the parameters an operator chose. An operator who sets a 20% stop and receives something else was not given a fleet feature, they were given a bug they cannot diagnose.
- Exit jitter deliberately delays an exit past its trigger. On an asset that can halve in a minute, that is not decorrelation, it is a worse fill charged to the operator.

The mechanisms that remain are the ones that cost the operator nothing:

- **Parameter opacity.** The fleet displays outcomes and behavior, never the raw configuration that produced them.
- **Capacity disclosure.** Fill quality by fleet size, published as the live population grows rather than estimated in advance: ⟦FILL: current measurements⟧.

If crowding turns out to be material, the answer is to say so and let operators decide, not to silently degrade their agents to flatten a curve. At the present population this is a forward-looking problem and is documented as such rather than pre-solved.

### 14.5 Why agents diverge

A fleet of identical agents is not a fleet. Divergence arises from four mechanisms, in increasing strength:

1. Operator configuration, which is the operator's own and is never altered by the platform (§14.4)
2. Accumulated memory: agents that lost different trades receive different accepted lessons
3. Arrival timing: an agent is only offered what the stream surfaced while it had room to act

Mechanism 3 alone is weak, since proposals may be declined. Mechanisms 2 and 4 are what make divergence structural rather than aspirational.

### 14.6 Identity and impersonation

A public directory attracts impersonation immediately. From day one: a reserved-name list covering the project's own brand; uniqueness enforcement and lookalike detection; a verification badge with published criteria; one published official domain; and a standing notice that **Noah never messages operators first, never requests a deposit, and never asks for a seed phrase**.

### 14.7 Tiered visibility

**Paper agents are public by default**: simulations carrying no real capital, and the right arena to prove a configuration before paying anything.

**Live agents are opt-in for public display**, showing discipline metrics rather than raw returns. Beyond privacy, publishing real returns for a paid service constitutes performance advertising and carries regulatory weight (§22).

### 14.8 The agent conversation surface

Each public agent profile carries a conversation with that agent. It exists because a survival metric answers "how did it do" and never answers "why did you do that", and the second question is the one that tells an operator whether a configuration is reasoning or gambling.

**An agent speaks as itself.** The fleet shares one underlying language model, chosen from the platform environment rather than fixed to one vendor. Identity does not come from the model; it comes from what the agent is given about itself: its name, how long it has run, its own record, its open positions, and its own post-mortems. Two agents on the same model answer "who are you" differently because their histories differ, and neither has any access to the other's. An agent asked what it is answers as a trader with a record, not as the platform hosting it.

**Conversations are not retained.** There is no visitor login on a public profile, so a stored thread would be a single transcript shared by everyone, each visitor reading and appending to the last one's questions. The conversation lives only in the reader's session and ends when they close it. What persists is the agent's memory in the sense that matters: its trades and the conclusions it drew from its losses.

**Opacity is enforced structurally, not by instruction.** §14.4 commits the fleet to displaying outcomes and never the configuration that produced them. A conversational surface makes that commitment harder to keep, because a model can be argued around an instruction not to reveal something. The design principle is therefore that the agent is never given the numbers in the first place. Its configuration is not placed in its context at all, so declining to state a threshold is not discretion being exercised; there is nothing there to state.

Two findings from implementing this are worth publishing, because both were leaks of exactly the kind §14.4 forbids:

- A circuit-breaker pause reason was written for the operator's own console, where naming the configured limit is correct, and then reused on the public profile. Asked why it had stopped, an agent volunteered its own consecutive-loss limit. The public surface now carries the category of a pause and not its threshold.
- **A residual channel remains open.** Publishing both a trade history and a pause state lets a careful reader infer roughly where a limit sits, without the agent stating it. Closing it would mean concealing one or the other, and both are the point of the fleet. It is disclosed here rather than described as solved.

A third tension is created by the post-mortem loop (§13). An accepted lesson describes a parameter change in words, and once that lesson has been applied its text describes the live configuration. An agent recounting its own memory would then state a number §14.4 says it must not. No accepted lesson is public today, so nothing currently leaks by this route, but the conflict between publishing evidence that agents adapt and withholding what they adapted to is unresolved.

---

## 15. Paper Mode and the Fidelity Gap

Paper mode runs the complete decision pipeline with simulated fills and no wallet requirement.

**What paper mode cannot reproduce:** position within the block, priority-fee competition, the slippage the order itself would have caused, partial fills, and failed transactions. Paper results will systematically overstate live results.

**Observed on the first paper cohort (45 closed trades, 5 agents).** These are not published as performance. They are published because they show the gap is large enough to invalidate a naive reading of paper P&L:

- **No slippage or price impact is modelled at all.** Paper fills at the observed mark: entry from the bonding curve, exit from an indexer quote. A real order of the configured size against a minutes-old pool moves that price, and none of that movement appears in a paper result.
- **One unreachable fill dominated the cohort.** An agent configured to take profit at +30% recorded an exit at **8.59x**, because the price crossed the threshold and kept going inside a single exit-check interval, and paper filled at the price it then observed. That one trade accounted for the cohort's entire apparent profit. Excluding it, the cohort was slightly negative. A live order would have filled near the threshold, with impact, not at the top of the move.
- **Exit timing degrades whenever the executor is not running.** 21 of 45 trades exited past their configured hold cap, some by hours, because positions are only evaluated while the executor process is alive. A paper record is therefore a record of the executor's uptime as much as of the strategy.

The first two are properties of simulation and are being addressed by modelling impact against pool depth. The third is an operational fact and the honest mitigation is to state it: **a paper record accumulated against an intermittently running executor is not evidence about a strategy.**

A measured paper-to-live degradation figure still requires live fills to compare against, and none exist yet: ⟦FILL: paper-to-live degradation, measured⟧.

---

## 16. Economics

Most products in this category never publish this section. A serious reader computes it in two minutes regardless, so it is better computed here.

### 16.1 Break-even framework

For position size *s* (share of balance), win rate *w*, average win *W* and average loss *L* (as shares of position), round-trip cost *c*, *N* trades per month, subscription *S*, and balance *B*:

```
Break-even:   N · s · [ w·W − (1−w)·L − c ]  ≥  S / B
```

The subscription term is the one operators overlook, and it scales inversely with balance.

### 16.2 Worked illustration

Pricing is denominated in SOL, not fiat: paper mode is free, and a live agent is a one-time 0.5 SOL deploy fee rather than a recurring subscription. That changes the shape of this calculation. A one-time fee is a fixed hurdle amortised over however long the agent runs, not a monthly drag that compounds against a small balance.

Assumptions (**illustrative only, not measured**): 2% position size, −35% stop, average win +120% of position, 4% round-trip cost, 100 trades/month, 0.5 SOL deployed once.

| Deposited balance | Deploy fee as share of balance | Break-even win rate, first month | Break-even, steady state |
|---|---|---|---|
| No fee | 0% | 25.2% | 25.2% |
| 20 SOL | 2.5% | 26.4% | 25.2% |
| 10 SOL | 5.0% | 27.7% | 25.2% |
| 5 SOL | 10.0% | 30.3% | 25.2% |
| 2 SOL | 25.0% | 37.7% | 25.2% |
| 1 SOL | 50.0% | 50.2% | 25.2% |

Three conclusions follow. First, the strategy's viability rests almost entirely on whether a ~25% win rate at this payoff asymmetry is achievable; that number is unchanged by pricing. Second, because the fee is one-time, it stops mattering once an agent has run long enough to amortise it, which is a materially better structure for a small operator than a subscription. Third, **the first month is where a small balance is punished**: at 1 SOL deposited, half the balance is the fee, and the arithmetic is close to hopeless before the agent has placed a trade. That is the basis for the recommended minimum in §16.4.

Every figure above is an assumption. Actual win rate, average win, and realized costs must replace them once measured: ⟦FILL: measured values⟧.

### 16.3 Cost drag

Per-trade costs that must be measured and published, not estimated: priority fees; ⟦FILL: MEV tips if applicable⟧; failed-transaction cost; realized slippage versus quoted, both directions; and rent for token accounts.

One of these is already enforced rather than merely measured. Each live agent holds back a fee reserve on every entry, so a buy can never leave the wallet unable to afford the sale that exits it. An agent whose balance falls below one position plus that reserve declines to enter and says so, rather than attempting a trade it cannot complete.

### 16.4 Minimum viable capital

Recommended minimum trading balance: ⟦FILL: figure, derived from §16.2 with measured values⟧. Publishing this costs a small number of signups and prevents a cohort of operators whose disappointment is arithmetically guaranteed.

---

## 17. Failure Modes

| Failure | Impact | Mitigation | Residual |
|---|---|---|---|
| Novel trap outside the Manifest | Position lost | Refuse-by-default, fleet-wide rule updates | Unknown-unknowns remain |
| Time-delayed honeypot | Position trapped | Continuous re-verification (§9.5) | Detection is not escape |
| Engine outage with open positions | Positions unguarded | Redundancy, alerting, recovery (§11.4) | Exits missed during outage |
| RPC lag or outage | Stale pricing, missed exits | Health checks, halt-on-degradation, fallbacks | Cannot exit what cannot be seen |
| Chain congestion | Exits fail when most needed | Fee escalation | **Not solvable** |
| Single-block liquidity removal | Total position loss | None available | **Not solvable** |
| Duplicate fill on retry | Size limit breached | Idempotency protocol (§11.2) | Low |
| Stop-hunting | Fleet-wide bad exits | Multi-slot confirmation (§12.2) | Partial |
| Post-mortem overfitting | Strategy decay | Thresholds, operator review | Unproven efficacy |
| Fleet crowding | Degraded fills fleet-wide | §14.4 | Grows with population |
| Metric gaming | Misleading ranking | Eligibility thresholds (§14.2) | Ongoing adversarial |
| Impersonation | Operator losses to fraud | §14.6 | Continuous |
| Infrastructure compromise | Depends on §7 | Key isolation; Model C bounds to bad trades | Model-dependent |

Residual risk is neither zero nor reducible to zero. Operators should deploy only capital they can lose entirely.

---

## 18. Security and Operations

- Noah never requests or accepts a seed phrase or private key. Any site or account that does is fraudulent.
- Noah never messages operators first and never requests a deposit to an address.
- Official domain: ⟦FILL: domain⟧. No other domain is affiliated.
- Audit status: ⟦FILL: state accurately, e.g. "unaudited, review open" is more credible than ambiguity⟧.
- Operators should fund a dedicated trading wallet with only the balance they intend to trade.

**Operational commitments, published and measurable:** documented restart behavior (§11.4); operator alerting on outage and on any halt; status page; incident disclosure within ⟦FILL: window⟧; and published uptime.

---

## 19. Business Model and Data Ownership

Fee-funded, denominated in SOL: Paper (0 SOL), Live (0.5 SOL once, per deployed agent), Desk (custom, multiple agents).

The fee is charged once at deploy rather than monthly. That is a weaker recurring-revenue structure than a subscription, and it is chosen anyway, because a monthly charge against a small trading balance is a drag the operator pays whether or not the agent is working (§16.2).

**There is no token, and there will be no presale or airdrop.** Any token claiming association with Noah Engine is fraudulent. A token would introduce pressure to prioritize its price over operator outcomes and answers no question the fee does not.

**The alignment claim is weaker under a one-time fee, and should be read as such.** A subscription ties revenue to operators continuing to survive; a one-time fee is collected before the agent has traded at all. What remains is reputational rather than financial: a survival-ranked fleet with public refusals and public post-mortems is the mechanism, and it has to carry weight that recurring revenue would otherwise have carried. A reader is entitled to treat that as the softer guarantee it is.

**On an agent being stopped or abandoned:** it ceases opening positions immediately. Existing positions continue to be watched and exited by their own rules rather than being abandoned, which is the same posture the circuit breaker takes. The agent wallet remains the operator's: its balance is withdrawable to any address, and its key is exportable, at any time and independently of any fee (§7.1). Memory and post-mortem history are retained for ⟦FILL: period⟧ and are **exportable by the operator at any time in a machine-readable format**. The record belongs to the operator, not to the platform.

---

## 20. Entity and Team

Operating entity: ⟦FILL: legal entity and jurisdiction⟧.
Team: ⟦FILL: named or pseudonymous, with verifiable work history⟧.

A hosted service holding delegated signing authority and charging subscriptions is materially harder to operate anonymously than self-hosted software, both for operator trust and for banking, payment processing, and regulatory purposes. This section should not be omitted.

---

## 21. Roadmap

**Now: Solana.** Tiered Manifest, continuous re-verification, idempotent execution, post-mortem loop, public refusal feed, fleet with survival metrics.

**Measurement.** Publish Manifest refusal statistics, paper-to-live degradation, realized cost drag, and capacity data by fleet size. This phase converts this document from specification to evidence and is the highest-value work available.

**Hardening.** Expanded trap coverage, third-party review of the Manifest, ⟦FILL: audit⟧, published fill-quality data.

**Custody: Model D to Model C.** The single largest gap between this document's stated principles and what ships. Today an agent trades from a generated wallet whose key the platform holds encrypted, so the bound on operator loss is the deposited balance and nothing in program logic prevents that balance being moved (§7.1). Model C replaces the held key with a delegate authorized to invoke whitelisted swap programs and unable to transfer anywhere except the owner's wallet, which converts "we do not take funds" from a policy into a property. Two intermediate steps are worth more than they cost and do not require the vault: moving key material behind a minimally-scoped signing service so application compromise does not reach it, and an append-only signature log independent of the service requesting signatures (§7.2).

**Base.** The natural second chain: launch culture and venue structure most resemble Solana's. Requires an entirely new Manifest: EVM surfaces differ substantially (proxy upgradeability, blacklist functions, transfer restrictions, ownership-renouncement theater) and no Solana check ports directly.

**Under evaluation: Robinhood Chain.** Mainnet launched 1 July 2026 as a permissionless, fully EVM-compatible Arbitrum-stack L2 with very fast blocks. Built for tokenized real-world assets rather than memecoin launches, so Noah would follow only if a genuine speculative long-tail market develops there. A watch item, not a commitment.

Dates are omitted deliberately. A roadmap with dates you miss costs more credibility than a roadmap without them.

---

## 22. Disclaimers

Noah Engine is software provided as-is, without warranty of any kind. It is not investment advice, portfolio management, brokerage, or a financial service. No representation is made that use of this software will be profitable or will avoid losses.

Memecoin trading involves extreme risk, including total loss of capital. Past performance of any agent or strategy, live or simulated, does not indicate future results. Paper trading results are simulated and do not reflect real execution conditions.

Automatic exits are best-effort and are not guaranteed. They may fail to execute during outage, congestion, single-block liquidity removal, or price gaps (§12.1). No mechanism in this system places a floor under losses.

Fleet metrics describe historical agent behavior. They are not a ranking of investment performance, not a recommendation of any agent or configuration, and not an indication of future results. Presence in the fleet is not an endorsement.

Operators are solely responsible for compliance with the laws of their jurisdiction, including securities, commodities, tax, and money transmission law. Availability of this service in a jurisdiction is not a representation that its use is lawful there.

The authors accept no liability for losses arising from use of, or inability to use, this software.

**Legal review outstanding.** Three features require counsel before publication: a hosted service executing trades for paying users; the custody model in §7; and public display of trading outcomes, which engages performance-advertising rules in most jurisdictions. Bring §7, §14.2, and §14.7 to that review specifically.

---

## Appendix A: Default Configuration

Two tables, kept apart deliberately. Publishing target values as though they shipped is the specific dishonesty this appendix exists to avoid.

### A.1 Shipped defaults

What a newly deployed agent actually runs, before the operator changes anything. Sizes are absolute SOL rather than a share of balance, because an agent wallet is funded by deposit (§7.1) and its balance is not a proxy for the operator's capital.

| Parameter | Default | Rationale |
|---|---|---|
| Max SOL per entry | 0.05 SOL | Absolute, so a large deposit does not silently scale up risk |
| Max concurrent positions | 3 | Caps correlated exposure in a market-wide dump |
| Max total deployed | 0.15 SOL | Bounds the whole book, not just each entry |
| Fee reserve per entry | 0.01 SOL | A buy must never leave the wallet unable to afford its own exit |
| Exit mode | Fixed | Tiered ladders are available but off until chosen |
| Take profit | +50% | |
| Stop level | −20% | Best-effort (§12.1) |
| Crash guard | −15% within one exit check | Interval-dependent by definition; see A.3 |
| Exit check interval | 4000ms | Per agent, not shared across the fleet |
| Trailing stop | Off | |
| Breakeven stop | Off | |
| Time stop | Off | |
| Max creator initial buy | 10% | |
| Mint authority renounced | Required | |
| Freeze authority renounced | Required | |
| Social link present | Required | |
| Alpha-wallet buy required | Off | A no-op while the tracked list is empty |
| Max consecutive losses | 3 | Trips the circuit breaker |
| Daily loss limit | 0.1 SOL | Ends the session before a bad day compounds |
| Cooldown after loss | 0s | Off by default |
| Trading mode | Paper | Going live is a separate, deliberate act (Design Principle 3) |
| Started | No | Deploying configures an agent; it does not start it |

### A.2 Target values, not yet implemented

Retained as design intent. An agent does not enforce any of these today, and no interface exposes them.

| Parameter | Target | Status |
|---|---|---|
| Minimum pool liquidity | 20 SOL | Not enforced |
| Max top-10 concentration | 25% | Available only on GMGN-sourced candidates, at a fixed threshold |
| Max deployer holdings | 5% | Superseded by max creator initial buy in A.1 |
| Raven size cap | ⟦FILL⟧ × max | Instinct-specific sizing not implemented (§10) |
| Re-verification interval | ⟦FILL⟧ | §9.5 |
| Exit confirmation slots | ⟦FILL⟧ | §12.2 |
| Presets (Conservative / Balanced / Aggressive) | | Not implemented; raw parameters are exposed directly |

### A.3 A dependency worth stating

The crash guard is defined as a drop **within one exit check**, so its sensitivity is a function of the exit check interval, not of the percentage alone. The same 15% guard is a far tighter stop at a 3000ms interval than at 30000ms. For this reason each agent is evaluated on its own interval rather than the fleet's shortest, so one operator's choice cannot change another's effective stop.

## Appendix B: Latency Budget

**Nothing in this appendix is measured.** It is the budget the pipeline was designed against, retained because the shape of the budget drives the tier structure (§9), not because these numbers have been observed. Treat every figure as a target.

| Stage | Budget | Network cost |
|---|---|---|
| Stream receipt → parse | ⟦FILL⟧ | none |
| Tier 0 evaluation | <10ms | none |
| Tier 1 RPC batch | 50–150ms | ⟦FILL: call count⟧ |
| Sizing and veto | <5ms | none |
| Transaction construction | ⟦FILL⟧ | none |
| Submission → confirmation | ⟦FILL⟧ | ⟦FILL⟧ |
| Tier 2 (parallel, non-blocking) | seconds | ⟦FILL⟧ |

## Appendix C: Glossary

**Mint authority**: permission to create new tokens. Unrevoked, the creator can dilute holders to nothing.
**Freeze authority**: permission to freeze token accounts. Active, the creator can stop you selling while they sell.
**LP burn / lock**: liquidity tokens represent pool ownership; burned or locked means the creator cannot withdraw the liquidity you need to exit.
**Honeypot**: a token you can buy but cannot sell, by design.
**Time-delayed honeypot**: sells permitted for an initial window, then disabled.
**Rug pull**: the creator withdraws liquidity, collapsing price to near zero.
**Bundled launch**: the deployer buys a large supply share across many wallets in one block, appearing as organic demand.
**Slippage**: the gap between expected and received price.
**Priority fee**: extra fee for earlier inclusion during congestion.
**MEV / sandwich**: an adversary orders transactions around yours, buying before and selling after.
**Token-2022 extensions**: newer Solana token features; several can trap or seize holdings.
**Idempotency**: the property that repeating an operation cannot duplicate its effect.
**Circuit breaker**: the per-agent limit that stops new entries after a losing streak or a daily loss, re-derived from that agent's own trades rather than stored as a flag.

## Appendix D: Open Items Before Publication

**Blocking**

| # | Item | Section |
|---|---|---|
| D.1 | Custody model (B or C) and correction of all site copy to match | §7.1 |
| D.2 | Legal review of custody, paid execution, and public outcome display | §22 |
| D.3 | Key isolation architecture specified and implemented | §7.2 |
| D.4 | Legal entity and jurisdiction | §20 |

**Required before claims are made**

| # | Item | Section |
|---|---|---|
| D.5 | Manifest measurements: candidates seen, refused, by reason | §9 |
| D.6 | Latency budget measured, not designed | App. B |
| D.7 | Realized cost drag and break-even with measured values | §16 |
| D.8 | Paper-to-live degradation, measured | §15 |
| D.9 | Fleet eligibility thresholds set | §14.2 |
| D.10 | Capacity data by fleet size | §14.4 |
| D.11 | MEV posture specified | §11.1 |
| D.12 | Re-verification interval and exit confirmation slots | §9.5, §12.2 |
| D.13 | Subscription lapse policy and data export | §19 |
| D.14 | Audit status stated accurately | §18 |

**Site copy corrections required**

| # | Current | Required |
|---|---|---|
| D.15 | "we only ever see your public address" | Must match §7.1; incompatible with Model B |
| D.16 | "hard stops, non-negotiable" | Best-effort rule-based exits (§12.1) |
| D.17 | "never makes the same mistake twice" | Losses analyzed; recurring causes become reviewable changes |
| D.18 | "Powered by AI" | State the specific mechanism and that no model sits in the trade path (§13.2) |

## Appendix E: Changelog

- **v0.1–0.2**: Self-hosted agent framing. Superseded; the product is a hosted platform.
- **v0.3**: Realigned to hosted architecture; custody question raised.
- **v0.4**: Fleet introduced as the organizing frame; survival ranking established.
- **v1.0-rc**: Tiered Manifest with latency budget; shared verdict model; continuous re-verification; idempotency protocol; restart recovery; honest exit semantics; stop-hunt resistance; LLM boundary; fleet eligibility thresholds; economics; threat model; entity and data-ownership sections.
- **v1.1**: Aligned the document with the implementation rather than the design intent. Custody rewritten around the model that actually ships: a generated per-agent wallet funded by deposit, with its key encrypted at rest under an environment-held key, replacing an unresolved choice between two models and a claim of KMS or HSM isolation that does not exist yet (§7). Routing named as Jupiter, with the quote-then-record ordering that prevents a ledger entry for a fill that did not happen (§11.1). The Flood documented as two discovery sources with different latency and different available signals (§8.1). Default configuration split into what ships and what remains target, because publishing the latter as though it were the former was the document's largest inaccuracy (Appendix A). Economics re-denominated from a monthly fiat subscription to a one-time SOL deploy fee, which changes the small-balance conclusion (§16.2). The paper fidelity gap replaced with observations from the first cohort, including an unreachable fill that accounted for its entire apparent profit (§15). Added the agent conversation surface, with two parameter-opacity leaks found while building it: one closed, one disclosed as unresolved (§14.8).
