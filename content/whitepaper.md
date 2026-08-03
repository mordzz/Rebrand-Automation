# Noah Engine
### A Public Fleet of Autonomous Trading Agents on Solana

**Technical Whitepaper · v1.0-rc**

> **Read this first.** Noah Engine is trading software. It's not a fund, not a broker, and not a promise. It doesn't guarantee profit, and it can lose money, including all of it. Memecoin trading is one of the riskiest things you can do in crypto. Nothing here is financial advice. See §22.

---

## 1. Overview

Noah Engine lets you deploy an automated trading bot (we call it an "agent") that trades new memecoins on Solana, around the clock, without you watching it.

Here's how it works in practice. You give your agent a name and a set of rules (how big each trade can be, when to cut a loss, when to take profit) and you turn it on. From then on it watches every new token as it launches, says no to almost all of them, and only risks money on the rare ones that pass its checks. When it loses money on a trade, it writes down what happened and why, so the loss is on the record rather than forgotten.

Every agent you deploy also joins a public list anyone can look at. You can watch other agents turn down tokens in real time, and read their write-ups after a loss. This list is **not a leaderboard of who made the most money.** It's ranked by whether an agent is still running, because ranking by profit just rewards whoever made the riskiest bet and got lucky, and teaches everyone watching to copy that bet.

The rest of this document explains exactly how the system works under the hood, not just what it's trying to do: the layered set of safety checks and how fast each layer has to run (§9), how one set of checks can serve every agent at once instead of repeating the same work per agent (§8.2), the safeguards that stop a single trade from accidentally being placed twice (§11.2), how an open position keeps getting rechecked even after you've already bought (§9.5), how the system recovers its own state if it restarts mid-trade (§11.4), and the honest limits of a "stop-loss" on the kind of exchange these tokens actually trade on (§12).

---

## 2. Key Terms

**Noah Engine.** The whole platform: the feed of new tokens, the safety checks, the code that actually places trades, the after-the-fact loss analysis, and the public list of agents.

**A Noah Agent (or just "agent").** One bot you've deployed. It has its own name, its own settings, its own wallet, and its own memory of what it's done.

**The Fleet.** Every agent currently deployed, taken together.

**Operator.** You: the person who owns an agent and the money it trades with.

**Stopped.** An agent that its operator switched off, or that hit its own automatic safety limit (a "circuit breaker") and paused itself. A stopped agent won't open any new trades, but it keeps watching and closing out anything it already holds, following the rules it was given.

---

## 3. Why "Noah"

Thousands of new tokens launch on Solana every single day. Almost all of them are worthless, and a good share are deliberately built to take your money. Finding tokens to trade was never the hard part. The hard part is turning almost all of them away.

We named this Noah for the discipline of the ark: you build the hull and decide who gets to board *before* the flood arrives, not while you're already underwater. Writing a bot that buys things eagerly is easy. Writing a bot that correctly says no thousands of times a day, and only says yes to the rare token worth the risk, is the hard part. That's also the part that decides whether your wallet is still standing a year from now.

The name also answers a question every trading platform eventually has to face: what does "winning" even mean here? An ark isn't judged by how much cargo it picked up along the way. It's judged by whether it was still floating once the water went down.

---

## 4. The Problem

**The market never sleeps.** New tokens launch at every hour of the day, with no pattern to when.

**You get minutes, not hours.** By the time a token gets posted in some call channel, whatever price move made it worth calling has usually already happened.

**A lot of these tokens are traps, on purpose.** Tokens you can buy but never sell ("honeypots"), tokens whose creator can freeze your wallet, hidden token features that let the creator drain holders, supply quietly split across many wallets to fake demand, liquidity that gets pulled the moment it's profitable to do so. Some meaningful share of every day's launches are built exactly this way.

**A bot that makes a mistake makes it over and over.** A person who misjudges one token loses on that one trade. A bot with the wrong settings repeats the same bad judgment on the next hundred tokens before anyone notices. That's why the risk-management part of the system is given authority over the part that decides to buy: not as a setting you can turn off, but built into the order things happen in (§10).

**The rest of the industry teaches you the wrong lesson.** Bot products show off their best trades. Trading competitions rank people by how much they made. Both push people toward taking maximum risk, because maximum risk is what tops a leaderboard. The operator who's still trading calmly a year later is invisible in that world. Nobody screenshots a boring, steady account.

---

## 5. Design Principles

1. **Say no by default.** A token has to actively pass every check that applies to it. If a check can't get an answer (data missing, unreadable, whatever), that counts as a fail, never a pass.
2. **Decide the rules before you're in the trade.** The stop-loss, the target, and the position size are all locked in the moment you enter, and the system enforces them automatically from there.
3. **Paper trading comes first.** Every agent starts in simulation mode, trading with fake money. Turning on real trading is a separate, deliberate step you take yourself.
4. **Your limits are hard limits.** Nothing in the system, not a retry, not a restart, not a partial failure, is allowed to spend more than your position size, hold more open trades than your concurrency cap, or lose more than your daily loss limit.
5. **Rank agents on survival, never on profit.** Every number we publish about an agent is chosen so that copying it is actually good advice.
6. **No AI model is in the trading decision itself.** Language models only look at what already happened, after the fact (§13.2).
7. **Everything is logged and explainable.** Every decision the system makes, including every refusal, is written down with its reason and the on-chain data behind it.
8. **No promises about performance.** We publish how the system works and what we've measured. We don't publish projections of what you might make.

---

## 6. What We Defend Against

Noah defends against the adversaries below. Anything not on this list should be assumed undefended.

| Who / what | What they can do | How we defend against it |
|---|---|---|
| Token creator | Builds a trap right into the token | The tiered Manifest safety checks (§9) |
| Token creator | Changes the token's behavior *after* you've already bought | Price-based exits recheck continuously; rechecking the sell path, tax, and authorities directly is not yet built (§9.5) |
| A "bundler" | Hides insider control of the supply behind what looks like organic demand | Deeper, slower checks that run in the background (§9.3) |
| A front-running bot | Reorders transactions around yours to profit off them | Slippage limits, plus a deliberate choice not to pay for front-running protection at this position size (§11.1) |
| A "stop-hunter" | Pushes the price down briefly just to trigger everyone's stop-loss at once | Requiring the move to hold for several slots before acting (§12.2) |
| A copycat operator | Copies another operator's exact settings | Settings aren't shown publicly, and agents naturally diverge anyway (§14.4) |
| Someone gaming the rankings | Optimizes for looking good on the list instead of trading well | Minimum activity required before an agent's stats are shown (§14.2) |
| An impersonator | Sets up a fake agent, site, or account | Name checks, lookalike detection, verification (§14.6) |
| An outside attacker | Breaks into Noah's own servers | Keys isolated per agent (§7.2); the long-term goal is a wallet design where even a full break-in can't move funds out (§7.1) |

**Not covered. Assume you're on your own here:** someone breaking into your own device or your own login; a crash across the whole crypto market; the Solana network itself going down; and an attacker powerful enough to reorder blocks at will.

---

## 7. Who Holds the Keys

### 7.1 How Your Agent Trades Without You Present

Your agent needs to be able to trade while you're asleep, on vacation, or just not looking at your phone. That means something needs the ability to sign transactions without you clicking "approve" each time. There are basically four ways to build that, and which one a platform picks says a lot about how much trust you're putting in it.

**Option A: you approve every trade yourself.** The only option where nobody else ever gets signing power. It also means your bot can't trade overnight or while you're away, which defeats the point of an autonomous agent.

**Option B: you give the platform standing permission to sign from your own wallet.** This gets you 24/7 trading, but it means the platform's servers genuinely *can* sign transactions as you. A platform doing this cannot honestly claim "we only ever see your public address": under this model, it can do far more than see it.

**Option C: a special on-chain vault that only lets your agent do one thing.** You deposit into an account controlled by code (a "program"), not by a private key. The agent is only allowed to call specific, pre-approved swap functions, and the code itself, not a promise, not a policy, makes it physically impossible to send your money anywhere except back to your own wallet. Under this design, even a full break-in on Noah's servers would only let an attacker make bad trades. They still couldn't steal the funds.

**Option D: a dedicated wallet for each agent, funded by deposit.** This is what Noah Engine actually runs today. When you deploy an agent, it gets a brand-new Solana wallet that belongs to it alone. The wallet you connect to log in is used only to prove you're the owner. Its keys are never asked for, never stored, never touched. To let your agent trade, you send SOL into its own wallet. You can pull that balance back out to any address whenever you want, and you can export the agent's private key if you'd rather hold it yourself.

Option D is not the same thing as Option C, and the difference matters if you're deciding whether to fund an agent:

- **What's actually limited:** the most you can ever lose is whatever you chose to deposit into that one agent's wallet. There's no way for money to flow from an agent's wallet back into your own wallet without your say-so, because Noah has no signing power over your wallet at all.
- **What's *not* limited:** Noah holds the private key to your agent's wallet, encrypted, and technically that key can sign anything, including sending the balance somewhere else entirely. Nothing in the code prevents this the way it does under Option C. This is a matter of us choosing not to, not a matter of it being impossible. Any claim that money sitting in an agent wallet "can't be taken" would simply be false, and we're not making that claim.
- **What you keep control of:** you can export the key at any time, so you're never stuck relying on us to hold it.

Option C is still the design we're aiming for. It's the only one of the four where "your funds can't be taken" holds up even against a determined attacker, and it's the only one that actually matches a product whose entire pitch is "we constrain what this bot can do." Moving from Option D to Option C is on the roadmap (§21) and hasn't been built yet.

Since Option D is what's actually running right now, the honest advice is the one in §16.4: only deposit what you're fully prepared to lose, regardless of how the trading itself goes.

**One rule that holds no matter which option is in play:** Noah will never ask you for your seed phrase or your private key: not in the app, not by message, not anywhere, under any excuse. If a site or an account claiming to be us ever asks for one, it isn't us, and it's a scam.

### 7.2 Keeping One Operator's Keys Separate From Everyone Else's

Any option where Noah holds signing power (Options B and C above) means Noah is holding that power for many different operators at once, on the same servers. Keeping one operator's key isolated from every other operator's is a separate engineering problem from which custody option is chosen, and it matters under either one.

Here's what's actually built today, stated as fact rather than as a goal:

- Every agent wallet's private key is **encrypted before it's stored**, using AES-256-GCM, an industry-standard encryption method. The encryption key itself lives only in the server's environment, never in the database, so someone who steals a copy of the database alone still can't unlock a single wallet.
- If that encryption key isn't available for some reason, the platform **refuses to create a new agent wallet at all**, rather than falling back to storing a key in plain, unencrypted text.
- Every agent has its own wallet and its own key. There's no single master key that could unlock every agent's wallet at once.
- No part of the app will ever hand back an encrypted key over an API. Exporting your own key requires you to sign a message with your own wallet first, proving it's really you asking. Everywhere else in the app, we just trust whatever wallet address the browser claims to be, which is fine for most things but not good enough for key material.
- The process that runs paper (simulated) trading is physically incapable of signing anything: the code for signing transactions isn't even loaded into it, and it never reads the real trading key.

Here's what's **not** built yet. Don't assume any of this exists:

- Keys are decrypted directly in the app's memory at the moment they're needed to sign something. There's no dedicated hardware or separate, narrowly-scoped signing service standing between the app and the key. A deep enough break-in on the server can reach key material while it's briefly unlocked.
- There's no independent, tamper-proof log of every time a signature was requested.
- The encryption key needs its own backup, separate from database backups. If it's ever lost, every agent wallet it protects is gone for good. There's no way to recover them.

Under Option C, once it's built, an attacker who defeated every one of the above could still only route funds back to the operator's own wallet, not steal them outright.

---

## 8. How the System Is Put Together

### 8.1 How a New Token Gets Evaluated

We call the constant stream of new tokens hitting Solana "the Flood," and we watch it two different ways.

One is a live feed straight from pump.fun that tells us about a new token within milliseconds of it launching. The other is a feed we poll every few seconds that also covers most other launch platforms (bags, believe, letsbonk, boop, heaven, moonshot, meteora, and more), including pump.fun itself. So it's not that one feed covers pump.fun and the other covers everything else; the second feed sees the same pump.fun tokens too, just a few seconds later. Both feeds feed into the same safety checks (which we call "the Manifest," explained in full in §9), and every token candidate remembers which feed found it.

These two feeds are not interchangeable, and the difference matters. The slower, polled feed arrives already carrying real market data: how concentrated the holders are, whether the creator has a history of rugging people, whether the supply is quietly split across linked wallets, whether it looks like a honeypot. The instant feed carries none of that; it only tells you a token exists. Whatever rules an operator sets are applied the same way no matter which feed found the token. If the feed itself doesn't provide the data a check needs, the check goes and reads it directly from the blockchain instead.

**Which feed is allowed to actually trigger a trade is something you control, and it defaults to the slower, better-informed feed only.** The instant feed is fast, but almost blind on its own: pump.fun automatically strips two of the things that sound most protective (the ability to mint more tokens, and the ability to freeze wallets) from *every single token it hosts*, whether it's legitimate or not. So those two checks pass for nearly the entire platform and don't actually tell you much. That leaves only keyword filters, social-media links, and how much supply the creator kept for themselves as the only filters with real teeth on the instant feed. Since the slower feed reaches the exact same tokens just a few seconds later, but carrying the information that actually separates a real project from a trap, the default setting trades a few seconds of speed for real evidence. You can turn the instant feed on if you want to be faster to the trade. Just know you're accepting a much weaker set of checks when you do.

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
                      ┌─────────────┼─────────────┐
                      │                           │
              ┌───────▼────────┐        ┌─────────▼─────────┐
              │  RAVEN         │        │  MANIFEST TIER 2  │  seconds,
              │  the only      │        │  deployer rug     │  never blocks
              │  entry (§10)   │        │  history, top-10, │  Raven
              └───────┬────────┘        │  bundling, tax    │
                      │                 │  (GMGN-sourced,   │
                      │                 │  fixed thresholds)│
                      │                 └───────────────────┘
          ┌───────────▼───────┐
          │  THE TIDE         │  sizing, risk budget, circuit
          │  (risk-limits.ts) │  breaker, enforced on every entry
          └───────────┬───────┘
          ┌───────────▼───────┐
          │    EXECUTION      │  quote → confirm → record (§11)
          └───────────┬───────┘
          ┌───────────▼───────┐
          │    THE ARK        │  exit checks on a fixed interval,
          │  (exit-logic.ts)  │  price-based only today (§9.5)
          └───────────┬───────┘
          ┌───────────▼───────┐
          │   POST-MORTEM     │  out-of-band analysis
          └───────────┬───────┘
          ┌───────────▼───────┐
          │    THE FLEET      │  public survival record
          └───────────────────┘
```

**A note on what changed in this diagram.** Earlier versions showed a second entry path, "the Wake," running after Tier 2 with a larger permitted size. §10 already explains why it was removed: Tier 2 cannot finish before the entry window closes, so a second, slower way to buy was never buildable within this pipeline. The Tide and the Ark are drawn as boxes here because they are real, but neither is a separately named module in the code. The Tide's behavior is `lib/sniper/risk-limits.ts`; the Ark's is `lib/sniper/exit-logic.ts`. Both run on every trade; they just aren't literally classes called "Tide" or "Ark."

Two things about this order really matter. First, safety comes before strategy: a token where the creator can still freeze your wallet gets thrown out before anything even considers buying it. Second, the deepest, slowest layer of checks (Tier 2) runs *alongside* the fast entry decision rather than blocking it, which is the only reason the system can be both fast and thorough at the same time (§9).

### 8.2 One Safety Check, Shared By the Whole Fleet

Whether a token passes our safety checks is a fact about the *token*, and it doesn't change depending on which agent is asking. So if three hundred agents all see the same new mint at once, we don't run the same checks three hundred separate times.

- Each check is computed **once per token**, the moment that token is first seen, and the result is shared with every agent evaluating it in that same pass.
- Each agent only does its own lightweight work on top of that: how big to size the trade, whether it fits the budget, whether its own strategy wants in. That part is cheap and personal to each agent.

**What this is not, today: a persistent, time-based cache.** Earlier drafts of this document described verdicts as cached with a tier-specific expiry and invalidated the instant an underlying account changed. That's the target, but it isn't what's running. What's actually built is simpler: a token's safety data is fetched once when the candidate is created, held only for as long as that candidate is being evaluated, and every agent sharing that pass reads the same copy rather than each fetching it fresh. If the same mint is evaluated again later as a new candidate, its data is fetched again from scratch rather than served from a cache. One exception: a bot configured with its own private RPC endpoint re-reads mint authority through that endpoint rather than reusing the shared copy, so a rate-limited public endpoint can't cause a false refusal for an operator paying for a better one.

Even without a formal TTL, this is what lets one set of safety checks serve a fleet of any size at a fixed cost per token, rather than at a cost that scales with how many agents are watching.

**One consequence worth saying out loud:** because every agent watches the same stream and gets the same verdict, they all see the exact same candidates at the exact same instant. Agents piling into the same token at once isn't a rare accident. It's baked into how the system works. We address that directly in §14.4 rather than pretend it won't happen.

### 8.3 How Fast Each Step Has to Be

The system is designed so the fastest layer of checks finishes within the same "slot" (Solana's basic unit of block time) as the token's pool being created, and the next layer finishes by the very next slot after that. The full breakdown of timing targets is in Appendix B.

---

## 9. The Manifest: the Safety Checks

The Manifest is the set of safety checks every token has to pass, and it's the single most important part of the whole system. It's built in layers, ordered from cheapest-and-fastest to slowest-and-deepest, because you genuinely cannot have maximum speed and maximum thoroughness in the same instant, and pretending otherwise would be dishonest.

### 9.1 Layer 0: instant checks, no extra lookups needed (under 10 milliseconds)

Everything in this layer can be read straight out of the data that already arrived with the token. No extra request to the blockchain needed.

- **Mint authority must be turned off.** If it's still on, the creator can print unlimited new tokens whenever they want, wiping out everyone else's share.
- **Freeze authority must be turned off.** If it's still on, the creator can freeze your wallet's tokens, stopping you from selling, whenever they want.
- **Token-2022 extensions** (newer, more powerful Solana token features that can also be abused):
  - A "transfer hook" is present → refused. This lets arbitrary code run every time the token moves, which can do almost anything.
  - A "permanent delegate" is present → refused. This lets someone other than you move your tokens without asking.
  - The token is marked non-transferable → refused. You could never sell it even under normal conditions.
  - The transfer fee is above our threshold → refused.
  - **The authority controlling the transfer fee hasn't been given up → refused.** It's not enough that the fee looks fine right now. If the creator can still change it, they can raise it toward 100% right after you buy in.
- We also record who currently holds "update authority" over the token, for reference.

### 9.2 Layer 1: quick blockchain lookups (roughly 50 to 150 milliseconds)

- How much money is actually sitting in the pool, checked against a minimum floor.
- A sanity check that the pool's reserves roughly match the token's reported total supply.
- Whether the pool's liquidity tokens are burned or locked. This matters because if they're not, the creator can pull the liquidity out from under everyone at any time. If they're locked with an unlock date, we record that date, though nothing yet forces an exit as it approaches (§9.5).
- How much of the supply the top 10 wallets hold between them.
- How much of the supply the creator personally holds.
- **An actual simulated sell**, run from the agent's real wallet, at the exact size the agent intends to buy. This catches tokens you can buy but can't sell.
- What it would actually cost in fees and price movement (slippage) to buy and then immediately sell back out, at the size the agent intends to trade.

### 9.3 Layer 2: the slow, deep checks (seconds, runs in the background)

This layer only runs on candidates that arrive through the polled feed (§8.1), because it depends on data the instant push feed never carries at all.

- The creator's history: what other tokens have they launched before, and what share of those rugged.
- How much of the supply is held by wallets whose funding traces back to a small, connected group, which is the signature of insider control dressed up as broad demand.
- Whether the launch looks "bundled": a large share bought up in a coordinated pattern rather than organic buying.

**Where this data actually comes from, stated plainly.** These three signals, along with the sell-tax and honeypot flags in §8.1, are not the product of a funding-graph or bundle-detection system Noah built. They are fields GMGN's own API already computes and reports per token, and Noah's contribution is choosing fixed, conservative thresholds and refusing anything that crosses them (see `lib/gmgn/safety.ts`): deployer rug history over 10%, bundler-held supply over 30%, insider concentration over 30%, top-10 holders over 35%. That data is genuinely useful and genuinely applied, but it is bought, not built, and this document should not have implied otherwise.

### 9.4 If We Can't Tell, We Say No

If any check that should run simply can't get an answer (the blockchain request times out, an account can't be read, we hit a token extension we don't recognize, whatever), the token is refused. We don't trade on incomplete information. If we see a Token-2022 feature we don't know how to evaluate, we treat it as dangerous rather than shrugging and letting it through.

### 9.5 Checking Again, and Again, After You've Already Bought

**Checking a token once, before you buy, isn't enough. The same risks the checks look for can appear *after* you're already holding it.** This is the goal, and it is only partly built today.

**What actually reruns on every open position, on the interval you configure (`exitCheckIntervalMs`, default 4 seconds):** the price-based exit rules in Appendix A.1: whether it has hit your take-profit, your stop-loss, your trailing stop, your crash guard, or your maximum hold time. This is real, and it runs continuously for as long as a position is open.

**What §9.5 originally claimed also happens, and does not yet:**

| What should be found | Currently implemented? |
|---|---|
| A sell would now fail, from a fresh simulation | No: the sell simulation runs once, before entry, and is never rerun on an open position |
| The sell tax has gone up | No |
| The pool's unlock date is coming up | No: the timestamp is recorded at Layer 1, but nothing forces an exit before it arrives |
| An authority has changed since entry | No |

**The consequence has to be stated as plainly as the rest of this document tries to be honest about everything else.** A **time-delayed honeypot** (a token where selling works for a while, passes the check at entry, and is then switched off) is not caught by anything running today. Entry simulation passing is the only assurance you have, and it is only true at the instant it was checked. This is now tracked as a target rather than a shipped protection; see Appendix A.2.

### 9.6 What Sell Simulation Can't Catch

Simulating a sell before buying is the single most valuable check in the whole system, but it has three real limits worth being honest about:

1. It only tells you the state of the world at that one instant. Passing the check when you buy is not a guarantee you'll still be able to sell later, which is exactly why §9.5 exists.
2. It can't catch a restriction that hasn't kicked in yet, for example a rule that only activates after a certain time or condition.
3. Some tokens block or allow specific wallets by name. That's why the simulation always runs **from the agent's own actual wallet**, and never from some shared test wallet that might get different treatment.

### 9.7 The Public Feed of Everything Refused

Every time any agent turns down a token, it shows up on a public, live feed, with the reason and which layer caught it:

```
17:04:12  T0  Sisyphus     refused  4Hq2…  freeze authority active
17:04:12  T0  Little Boat  refused  4Hq2…  freeze authority active
17:04:19  T1  Sisyphus     refused  9Kp7…  top-10 holds 61%
17:04:23  T1  Driftwood    refused  Bn3x…  sell simulation failed
17:04:31  T2  Little Boat  refused  Cw8m…  deployer: 4 prior rugs
17:06:02  RV  Driftwood    exited   Ka4p…  sell simulation began failing
```

This feed runs continuously and would be very hard to fake convincingly. It shows the whole point of this system in action, without us having to make a marketing claim about it.

---

## 10. The Three Instincts (Raven, Ark, Tide)

Every agent you deploy actually runs three separate pieces of logic under the hood. Think of them as three instincts: one that wants to act, and two whose job is to hold it back.

**The Raven, the one that gets in early.** This is the only piece that ever opens a new trade. It acts on Layer 0 and Layer 1 results only, because nothing slower can finish in the tiny window a brand-new token gives you.

**The Ark, the one that guards a position once you're in it.** This never opens a trade. Once a position is meaningfully in profit, it locks in a "no worse than breakeven" floor. As momentum fades, it tightens the exit. It closes the position on a stall, a drawdown, or a sudden crash.

**The Tide, the one in charge of the overall session.** It sizes every trade against your risk budget, enforces every limit you've set, ends the day's trading once the daily loss limit is hit, and manages the rhythm of turning post-mortems into config changes you can review.

**The Raven wants to act. The Ark and the Tide are there to say no.** Whenever they disagree, the Ark and the Tide win, always. This isn't a setting that can be toggled off; it's built into the order the code runs in. You control how aggressive the Raven is allowed to be. You cannot turn off the Ark or the Tide.

**A note on a second way to enter a trade.** Earlier versions of this design included a second, slower entry method: one that waited for more complete information before buying, and was allowed to take a bigger position because of it. We removed it rather than just postponing it, for two reasons, and the second is the real one. It depended on a Layer 2 result arriving before entry, which the speed budget doesn't allow (§8.3). And shipping a second way to buy doubles the amount of new logic that needs proving out, while the first one (the Raven) doesn't even have a live track record yet. A platform built around restraint shouldn't ship a second way to buy before it's shown the first one actually works.

---

## 11. Execution

### 11.1 How a Trade Actually Gets Sent

- **Trades are routed through Jupiter**, a swap aggregator that finds the best price across Solana's exchanges. We get a price quote first, and we only write down that a position exists *after* the swap actually confirms on-chain, using the transaction's own signature as proof it happened. That way a failed attempt can never accidentally create a record of a trade that never occurred. If there's simply no route to trade a token, we skip it rather than force it through.
- **We set a hard limit on slippage**: how much worse a price we'll accept than quoted. If the actual fill would be worse than that, we walk away rather than chasing a worse price. Right now that limit is based on how far away the agent's stop-loss is, on the reasoning that a fill worse than your stop is a fill you didn't want anyway.
- **Priority fees**, extra payment to get included in a block faster during congestion, are left to Jupiter's own defaults today. Calculating our own fee from recent network congestion, capped by a setting you control, is a target and not yet built: ⟦FILL: whether and when this ships⟧.
- **We deliberately do not do anything special to avoid front-running.** No private bundle submission, no tips to block builders. At the position sizes this system trades, a tip large enough to matter would cost more than the front-running it's trying to avoid. If positions ever got much bigger, this would need to be revisited.
- **How much compute budget each transaction requests** is tuned per action, to cut down on wasted, failed transactions.

Failed transactions still cost SOL in fees, even though they didn't do anything. Every agent keeps a reserved balance set aside just for fees, and it stops trading rather than letting that reserve run dry.

### 11.2 Making Sure a Trade Never Gets Placed Twice by Accident

The single most dangerous bug this kind of system can have is naively retrying a trade. Here's the failure mode: a transaction actually goes through on-chain, but the system never sees the confirmation come back. Network hiccup, timeout, whatever. If it just tries again, you now have **two positions instead of one**, quietly blowing past your own size limit without anyone deciding that should happen.

**The actual protection is simpler than a full intent-tracking system, and it's worth describing exactly rather than describing a more elaborate design we don't run.** There is no persisted intent ID created before a transaction is built, and there is no automatic retry at all: a swap either lands, or it fails, or its outcome is unclear, and the code is written to never guess which:

1. A signature is computed for the swap the moment it's signed, before it's sent, so we can always name the transaction we attempted even if the send itself times out.
2. Sending is followed by polling the chain directly for that signature's status, rather than subscribing and hoping a notification arrives. A transaction the cluster rejected outright (bad simulation, insufficient funds) is treated as a clean failure. Anything else unclear about the outcome, including the connection dropping mid-poll, is treated as unresolved, never as a success.
3. **Nothing here retries automatically.** If a swap's outcome comes back unresolved, that failure is surfaced and logged; sending it again is a decision the caller has to make deliberately, after checking the chain, not something the system does on its own.
4. That check happens by reading the agent's actual on-chain token balance. If a position is marked open in our database but the wallet holding it has none of that token, the position is closed against the chain rather than retried or left open forever. This is how a swap that landed without us seeing the confirmation gets reconciled, rather than duplicated.
5. Whatever the blockchain says is the final word. Where our database and the actual chain state disagree, the chain wins, and the database is corrected to match it, even if that means writing down a fill we didn't ourselves observe.

We do not use Jito bundles today, so the specific failure mode where a bundle silently fails to land with no error at all doesn't currently apply. If bundle submission is added later, the same rule would have to apply to it: never assume success just because nothing went wrong.

### 11.3 Tracking Every Transaction to Its Actual Outcome

Every transaction is followed until we know what actually happened to it, but not through a formal five-state record stored per transaction. What exists today is two outcomes a swap can fail with, each handled differently: a transaction the chain rejected outright is treated as **terminal**: the fee is spent and there is nothing to reconcile. A transaction whose outcome we couldn't establish (the connection dropped, the blockhash expired before we got an answer) is treated as **unresolved**, and the rule from §11.2 applies: it gets checked against the chain before anything is retried, never assumed to have failed or succeeded. We never guess a transaction's fate from silence.

### 11.4 Recovering State If the System Restarts

If the whole system restarts while agents are holding open positions, we **cannot** just trust whatever the database says. If the database has fallen even slightly behind the actual chain, an agent could wake up completely unaware it's holding a position nobody's watching.

So on every restart, for every position our database still marks open:

1. If the position belongs to a bot that no longer exists (deleted while it was holding something), we log it as **orphaned**: nobody can act on it automatically, and an operator needs to notice and take manual action.
2. Otherwise, we check what that agent's wallet is actually holding for that token, directly on-chain.
3. If the wallet holds none of it, the position is closed as **reconciled**: it clearly already exited somewhere we didn't observe, and there is nothing left to guard.
4. If the on-chain balance can't be read at all (RPC trouble), the position is left open rather than guessed at, and it's picked up again on the next cycle.
5. Once a position survives that check, it resumes under whatever configuration the agent currently has. That configuration is read fresh on every cycle regardless of restarts, so there is no separate "reload settings" step.

**What this does not yet do:** reconstruct an entry price from on-chain transaction history if the database's own record is missing or wrong, or re-run the Manifest and a fresh sell simulation on a recovered position before resuming it. Both are listed as gaps in Appendix D rather than assumed.

**A position discovered on-chain that our own records never knew about is not something this process currently adopts automatically.** Closing that gap, and the two above, is on the roadmap rather than shipped. Restart behavior is published here, honestly, because it's part of the operational contract with you (§18), not because every part of it is finished.

---

## 12. How Exits Actually Work

### 12.1 What a Stop-Loss Is, and Isn't

**There's no such thing as a real "stop order" on an AMM** (an automated market maker: the kind of exchange these tokens trade on, which has no order book, just a pool of two assets you trade against). What we call a "stop-loss" is really Noah watching the price and submitting a sell once it's crossed a threshold. That makes it best-effort, not guaranteed, and it can fail to protect you when:

- Our system itself is down.
- The network is too congested for our exit transaction to get through at the fee we're willing to pay.
- Liquidity gets pulled out of the pool in a single block, before we can react.
- The price jumps straight past your stop level between one check and the next, without ever trading at the price in between.

Memecoins move violently, and liquidity getting pulled in a single block happens regularly. These aren't rare edge cases; they're things you should expect to happen sometimes.

Because of that, we describe our exits as **automatic exits based on rules, carried out on a best-effort basis**, never as a guaranteed stop, and never as something that puts a hard floor under how much you can lose. If you ever see marketing copy calling these "hard stops" as if they're guaranteed, that's wrong and should be corrected. The first person who loses money jumping straight past one will be completely right to call it out.

### 12.2 Making It Harder to Trigger a Fake-Out Exit

If an exit is triggered off a single price reading, it's trivially easy to fake out: someone dumps a large sell to briefly tank the price, every agent holding that token panics and sells at the bottom, and then the price recovers right after. The manipulator profits, everyone else eats the loss. Because every agent shares the same price feed and the same verdicts, a trick like this could hit the **entire fleet at the exact same moment**, turning one person's manipulation into a fleet-wide event.

The guard described here (averaging price over several slots, requiring a move to hold before acting) is a target, not something running today: exits currently act on a single price read from DexScreener, the same reading every agent sharing that price feed would also see. None of the numbers below are implemented yet, so none are measured either.

- The price used to trigger an exit would be averaged ⟦FILL: over how many recent slots, weighted by the pool's actual reserves⟧, not read from a single instant.
- A normal (non-emergency) exit would need to see the trigger hold for ⟦FILL: how many⟧ slots in a row before it fires.
- **The design intends one exception:** an emergency exit, once the sell-simulation recheck in §9.5 is built, would skip that confirmation delay entirely, because in that specific case waiting is the riskier option. Today there is no sell-simulation recheck to trigger it from.

---

## 13. The Post-Mortem Loop

### 13.1 How It Actually Works

1. When a losing position closes, we bundle up what we have about it: entry price, exit price, position size, realized loss, how long it was held, and whatever additional context was recorded on the trade.
2. That single trade, on its own, gets analyzed to name the most likely cause: entered too late, held too long, take-profit set too slow or too greedy, stop-loss too tight or missing, a rug or liquidity drain no timing could have caught, or an oversized position.
3. If the cause maps cleanly onto one of your exit settings, a specific, concrete config change is proposed for your review.
4. **You review that suggestion and decide whether to accept it. Nothing ever changes your settings automatically or silently.**

**Two things this does not currently do, stated plainly rather than left implied.** First, there is no repetition threshold: each losing trade is analyzed on its own, with no memory of prior trades or prior lessons, so a proposal can be generated from a single loss rather than only after a cause recurs. §13.4 explains why that matters. Second, a proposal only ever touches your own agent's own exit-related settings (take-profit, stop-loss, trailing, breakeven, max hold time, crash guard, creator-buy limit, cooldown). It has no path to changing a Manifest rule that applies fleet-wide. If your agent's loss reveals a genuine gap in the Manifest itself, closing that gap today requires the platform to make the change directly. It does not happen automatically through this loop.

### 13.2 Where AI Is Actually Involved (and Where It Isn't)

**No AI model has any say in whether, when, or how a trade happens.** Getting an answer out of a language model takes seconds; the actual trading system has to make decisions in milliseconds. Those two speeds are simply incompatible, and any product that implies an AI is making live trading calls is describing something that physically cannot work that fast.

Language models are only used **separately, after the fact**, to analyze a position once it's already closed. Every decision about entering a trade, sizing it, and exiting it is made by fixed, predictable rules: the kind where the same inputs always produce the same answer, and every one of those inputs is logged.

We'd rather say exactly this than lean on a vague "Powered by AI": the specific claim is both more believable and simply more accurate.

### 13.3 Managing an Agent's Growing Memory

An agent's history just keeps growing, but there's a hard ceiling on how much text an AI model can actually look at in one go. There are two separate places this matters, and they're handled differently.

**Post-mortem analysis (§13.1) doesn't face this problem today, because it isn't looking at your history at all.** Each losing trade is analyzed in isolation, with no prior trades or prior lessons in view. That keeps it well under any context limit, but it's also the reason there's no repetition threshold: the analyzer has no memory to check a cause against.

**The agent's public conversation (§14.8) does pull from history**, and does so with a fixed, simple bound rather than a summarization strategy: the 20 most recently accepted lessons, most recent first. Every individual post-mortem is still kept in full and permanently, and you can always read the complete record yourself; what the conversation surface sees is a recent slice of it, not a summary of everything.

### 13.4 Where This Loop Can Go Wrong

- **A handful of losses can lie to you, and nothing currently stops that.** A few losing trades in one market condition can look like a pattern when it's really just noise. The honest fix is a repetition threshold, requiring a cause to recur before it's surfaced, but that isn't built yet (§13.1): today, one loss is enough to generate a proposal.
- **The natural failure mode is chasing the last thing that hurt you**, and the lack of a repetition threshold makes this worse, not just theoretical. Two accepted-lesson drafts observed six minutes apart, both about the same agent's hold time, told it to move in opposite directions: one to hold longer, the next to hold less. Neither was wrong given the one trade it saw; neither had any memory of the other.
- **AI analysis can sound completely confident and still be wrong.** Language models are good at writing a plausible-sounding explanation for what happened, even when that explanation is incorrect. That's exactly why you're the one reviewing it, not the system applying it on its own.
- **We haven't proven this loop actually works yet.** Whether accepting these suggested lessons measurably improves outcomes over time is a real open question we don't have an answer to. How we'll measure that: ⟦FILL: not yet decided⟧.

---

## 14. The Fleet

### 14.1 What's Public, and What's Not

**Public:** the feed of refusals; every agent's name, face, and how long it's been running; its survival stats; its post-mortems, if the operator allows them; the full trade history of paper agents; and live agent activity, under the rules in §14.7.

**Not public:** who owns the agent, how much money is in its wallet, and the **exact numbers in its settings** (§14.4).

### 14.2 There's No Leaderboard

**There's no leaderboard ranking agents by how much profit they made.** A profit ranking just rewards whoever took the single biggest bet on the luckiest day. Every rational operator responds to that by taking on more and more risk, so the agents at the top of the list become the most reckless ones in the fleet, exactly the behavior a newcomer would then go copy.

An earlier version of this plan tried to fix that with a "survival" ranking instead (days still running, refusal rate, stop discipline, capital kept, worst drawdown), gated behind a minimum activity level so an agent that just never traded couldn't top the list by doing nothing. We've dropped that too, and taken a stronger position instead: **the fleet is a directory you can browse, not a competition with a winner.**

Here's why, and it's the same reasoning that forced those minimum-activity gates in the first place: ranking a small group of agents on five different numbers mostly produces noise, not a meaningful signal. Needing gates to stop people gaming a ranking is really an admission that the ranking itself gives people a reason to game it. Removing the ranking removes that incentive at the source, and it doesn't cost you anything you actually need. Every agent's full record is published anyway, and you can compare any two agents directly yourself.

What each agent shows about itself:

| Shown | Why |
|---|---|
| Age since deploy | Whether a record is long enough to mean anything |
| Positions taken, and closed | The denominator for everything else |
| Realized result, paper or live, labelled | Never a ranking, and never comparable across different deposit sizes |
| Refusals, with reasons | The behavior we're actually claiming |
| Post-mortems, where the operator allows them | Whether it actually learns |
| Open positions | What it's exposed to right now |

**We never publish a number without also showing what it's based on.** A "win rate" calculated from four trades isn't a meaningful win rate. If an agent doesn't have enough trades yet, it shows the raw count instead of a percentage.

### 14.3 Agents Don't Coordinate: a Promise We're Not Walking Back

Agents can see each other exist. **They do not talk to each other, and they never will.**

If hundreds of agents all pile into a thin, low-liquidity pool at the same moment, that's functionally indistinguishable from coordinated market manipulation, and it would be happening on a platform that built the mechanism for it and charges people to use it. So we're committing to this permanently:

- No agent ever signals a trade to another agent.
- No shared entry triggers, no synchronized buying.
- No feature whose whole effect is getting many agents to pile into the same token in the same window.
- Any crowding that happens on its own is treated as a real problem to engineer against, not something we shrug off (§14.4).

Agents share a **public record** with each other: what happened, and what was learned from it. They never share a live signal telling each other what to do right now.

### 14.4 When Many Agents Compete for the Same Trade

Because every agent watches the same stream and gets the same verdict (§8.2), agents competing for the same fills isn't a bug. It's just what happens as more agents get deployed. As the fleet grows, more agents end up wanting into the same tokens at the same time.

We looked at ways to engineer around this: capping how many agents can enter the same candidate, randomizing each operator's settings slightly within their own chosen range, deliberately delaying some exits to spread them out, capping the total number of live agents. **We rejected every single one of these.** Each one makes the aggregate numbers look better by quietly making some individual operator's agent perform worse than what they actually configured, without being upfront about it:

- Capping entries per token means denying an agent a trade it legitimately qualified for, just so a different customer's agent gets it instead.
- Randomizing settings overrides the exact numbers you chose. If you set a 20% stop and got something else, that's not a helpful fleet feature. That's a bug you'd have no way to even notice.
- Deliberately delaying an exit past when it should have fired isn't "spreading out the risk." On an asset that can drop 50% in a minute, that's just a worse fill, and you're the one who pays for it.

What we're doing instead costs you nothing:

- **We don't show anyone your exact settings.** The fleet shows what an agent did and how it turned out, never the raw numbers behind it.
- **We publish how fill quality changes as the fleet grows**, measured as it happens rather than guessed at ahead of time: ⟦FILL: no measurements exist yet⟧.

If crowding turns out to genuinely hurt performance as the fleet scales, the right answer is to say so publicly and let you decide what to do about it, not to quietly water down your agent to smooth out a chart. Right now, with a small fleet, this is mostly a problem for the future, and we're documenting it as one instead of pretending it's already solved.

### 14.5 Why Two Agents End Up Behaving Differently

A fleet where every agent behaves identically isn't really a fleet. Three things make agents diverge from each other, in increasing order of how much they actually matter:

1. **Your own settings**, which are yours alone, and the platform never changes them (§14.4).
2. **Accumulated memory**: agents that lost different trades get offered different lessons to accept.
3. **Timing of arrival**: an agent only ever gets offered whatever the stream happened to surface while it had room to act.

Timing alone doesn't create much real divergence on its own. Two agents with identical settings, just seeing a different slice of the same stream, will still tend to look similar over time, because they're applying identical rules to different examples. It's your own settings, combined with what your agent has personally learned from its own losses, that create real, lasting differences between agents.

### 14.6 Preventing Fake Agents and Impersonators

A public directory of agents is going to attract impersonators almost immediately, and this is the intended design: certain names tied to the Noah brand itself should be reserved and unusable; every agent name should be checked for uniqueness and for lookalikes designed to trick people; there should be a verification badge with clearly published rules for who gets one; and there is exactly one official domain, published clearly in §18.

**None of the naming protections are built yet.** Deploying an agent today accepts any name you type, with no uniqueness check and no lookalike detection. This is tracked as an open item rather than assumed done (Appendix D). The one rule that doesn't depend on any of this, and that you can rely on regardless: **Noah never messages you first, never asks you to send a deposit somewhere, and never asks for your seed phrase.**

### 14.7 Paper Agents Are Public, Live Agents Choose

**Paper (simulated) agents are public by default.** They're not risking any real money, so this is the right place to prove out a configuration before you ever pay anything.

**The design intends for live agents to choose whether they're shown publicly at all, and for what's shown to be discipline rather than raw dollar returns.** That opt-in choice is not built yet: every deployed agent, live or paper, currently appears on the public fleet page unconditionally. Beyond privacy, publishing actual returns for something people pay for legally counts as performance advertising, which carries its own regulatory weight (§22), which is precisely why this gap is listed here rather than left unstated (Appendix D).

### 14.8 Talking to an Agent Directly

Every public agent profile lets you actually talk to that agent. This exists because a survival stat can tell you "how it did," but never "why it did what it did," and that second question is the one that actually tells you whether an agent's settings reflect real reasoning or just gambling.

**Each agent talks as itself, not as a generic bot.** Under the hood, every agent shares the same underlying language model, chosen from whichever provider the platform is running rather than locked to one vendor. But its personality doesn't come from the model. It comes from what it's told about itself: its name, how long it's been running, its own record, what it currently holds, and its own past post-mortems. Two agents built on the exact same model will answer "who are you" completely differently, because they have different histories, and neither one has any access to the other's. Ask an agent what it is, and it answers as a trader with an actual track record, not as "the platform hosting me."

**Conversations aren't saved anywhere.** There's no login for people just visiting an agent's public page, so if we saved a conversation, it would just be one shared transcript that every visitor was reading and adding to. Instead, the conversation only exists in your own browser session, and disappears when you close it. What actually persists for the agent is its real memory: its trades, and what it concluded from its losses.

**We keep settings hidden by design, not by just telling the model to keep quiet about them.** §14.4 commits us to never showing the raw numbers behind an agent's behavior. A chat feature makes that harder to guarantee, because a language model can sometimes be talked around an instruction not to reveal something. So instead of relying on an instruction, we simply never give the agent its own configuration numbers in the first place. When it declines to tell you its stop-loss percentage, it's not choosing not to say. It genuinely doesn't have that number to say.

Two things we learned while actually building this are worth telling you about, because both were exactly the kind of leak §14.4 is meant to prevent:

- The message explaining why an agent's circuit breaker had paused it was originally written for the operator's own private dashboard, where naming the specific limit makes sense. That same message text got reused on the public page by mistake. Asked why it had stopped, an agent literally told a stranger its own consecutive-loss limit. We fixed this. The public page now only says *what kind* of thing paused it, never the exact number.
- **One gap is still open.** If you publish both an agent's full trade history *and* the fact that it's currently paused, a careful reader can work out roughly where one of its limits sits, purely by doing the math themselves, even though the agent never says the number out loud. Closing this would mean hiding either the trade history or the pause status, and both of those are the whole point of the public fleet. We're telling you about this rather than pretending it's already solved.

There's a third tension worth naming, created by the post-mortem loop itself (§13). When you accept a suggested lesson, it's described in plain words as a specific settings change, and once it's applied, that same text now describes your agent's actual live configuration. If the agent then talked about its own memory, it could end up stating a number §14.4 says it shouldn't. No accepted lesson is public today, so this isn't leaking anything in practice yet, but the underlying conflict, between showing evidence that agents actually learn and hiding exactly what they learned, is still unresolved.

---

## 15. Paper Trading, and Why It Doesn't Match Real Trading

Paper mode runs the exact same decision-making pipeline as real trading, but with simulated fills instead of real ones, and no wallet needed at all.

**What paper mode simply can't simulate:** where your transaction lands within a block, competing with everyone else for priority fees, the price impact your own order would have caused, partial fills, or failed transactions. Because of this, paper results will always look systematically better than real trading would.

**Here's what we actually saw in our first batch of paper trades: 45 closed trades, across 5 agents.** We're not publishing these numbers as a performance claim. We're publishing them because they show the gap between paper and real trading is big enough that you shouldn't read paper profit-and-loss numbers at face value:

- **Paper mode models zero slippage and zero price impact.** It fills at whatever price it observed: the bonding-curve price going in (the pricing formula pump.fun uses before a token has a real liquidity pool), an indexer's quoted price going out. In reality, an order the size these agents trade would move the price of a pool that's only minutes old, and none of that shows up in a paper result.
- **One single unrealistic trade accounted for the whole batch's apparent profit.** One agent set to take profit at +30% actually closed at **8.59x** in the simulation, because the price kept climbing past the target inside a single check interval, and paper mode just filled at whatever price it happened to observe next. That one trade was responsible for the *entire* apparent profit of the batch. Take it out, and the batch was actually slightly negative. In real trading, that order would have filled near the 30% target, with real price impact, not at the very top of the spike.
- **Exit timing gets worse whenever the trading process isn't actually running.** 21 of the 45 trades exited later than their configured maximum hold time, some by hours, simply because positions only get checked while the process is alive. So a paper track record partly measures how reliably our own software was running, not just the strategy itself.

The first two issues are limits of the simulation itself, and we're working on modeling price impact against actual pool depth to fix them. The third is just an operational fact, and the honest thing to do is say it plainly: **a paper trading record built up while the trading process kept going down is not real evidence about whether a strategy works.**

Actually measuring the real gap between paper and live results requires having live trades to compare against, and we don't have enough of those yet: ⟦FILL: not yet measured⟧.

---

## 16. The Economics: Can This Actually Pay Off For You?

Most products like this one never bother publishing this section. Anyone who actually sits down and does the math can work it out in two minutes anyway, so it's better that we just show it to you directly.

### 16.1 The Math for Breaking Even

Using: position size *s* (as a share of your balance), win rate *w*, your average win *W* and average loss *L* (each as a share of the position), the round-trip cost *c* of getting in and out, *N* trades per month, any subscription fee *S*, and your balance *B*:

```
Break-even:   N · s · [ w·W − (1−w)·L − c ]  ≥  S / B
```

The subscription term is the part operators tend to overlook, and notice that it gets *worse*, not better, the smaller your balance is.

### 16.2 A Worked Example

We price in SOL, not dollars: paper mode is free, and going live is designed to cost a one-time 0.5 SOL fee rather than a recurring subscription (§19 explains that this fee is not actually being collected yet). This math describes the shape of the business as intended. A one-time fee is a fixed hurdle you clear once, and it matters less the longer your agent runs, not a monthly drag that keeps compounding against a small balance forever.

Using these assumptions (**for illustration only, not measured, not a promise**): a 2% position size, a 35% stop, an average win of +120% of the position, a 4% round-trip cost, 100 trades a month, and the 0.5 SOL fee paid once.

| Deposited balance | Deploy fee as share of balance | Break-even win rate, first month | Break-even, steady state |
|---|---|---|---|
| No fee | 0% | 25.2% | 25.2% |
| 20 SOL | 2.5% | 26.4% | 25.2% |
| 10 SOL | 5.0% | 27.7% | 25.2% |
| 5 SOL | 10.0% | 30.3% | 25.2% |
| 2 SOL | 25.0% | 37.7% | 25.2% |
| 1 SOL | 50.0% | 50.2% | 25.2% |

Three things fall out of this. First, whether this strategy actually works comes down almost entirely to whether you can realistically hit around a 25% win rate at this kind of payoff, and that number doesn't change no matter what we charge. Second, because the fee is one-time, it stops mattering at all once your agent has run long enough to earn it back, which is a much better deal for a smaller operator than a monthly subscription would be. Third, and this is the important one: **the very first month is where a small balance gets punished hardest.** If you deposit just 1 SOL, half of it is the deploy fee, and the math is nearly hopeless before your agent has even placed a single trade. That's exactly why we recommend a minimum balance in §16.4.

Every number above is an assumption, not a measurement. Real win rate, real average win, and real costs need to replace these once we've actually measured them: ⟦FILL: no measured values yet⟧.

### 16.3 What Trading Actually Costs

The real, per-trade costs we owe you measured numbers on, not just estimates: priority fees; the cost of failed transactions; the actual slippage you got versus what was quoted, on both the buy and the sell; and the small amount of SOL locked up as "rent" for holding a token account. MEV tips don't apply: §11.1 already states we pay none.

One of these is already actively enforced, not just measured. Every live agent holds back a reserve on every entry, specifically so a buy can never leave the wallet without enough left to afford the sale that eventually gets it out. If an agent's balance drops below one position size plus that reserve, it simply declines to enter a new trade and says why, rather than attempting a trade it can't actually finish.

### 16.4 The Smallest Balance Worth Starting With

Our recommended minimum balance to start trading with: ⟦FILL: a real number, once §16.2's figures are actually measured⟧. Publishing this honestly will cost us a few signups from people who'd deposit less, but it saves a whole group of operators from a disappointment the math already guarantees before they even start.

---

## 17. What Can Go Wrong

| What can go wrong | What it costs you | How we reduce it | What's left over |
|---|---|---|---|
| A brand-new type of trap our checks don't know about yet | Losing that position | Refuse-by-default, plus updating the rules fleet-wide once we find one | Unknown risks always remain |
| A time-delayed honeypot (selling works, then gets switched off) | Getting stuck holding a token you can't sell | None today; sell simulation only runs once, before entry (§9.5) | Not currently mitigated |
| The system going down while you have open positions | Your positions sit unguarded | Redundancy, alerts, and recovery on restart (§11.4) | Exits can still be missed during the outage itself |
| Solana RPC (our connection to the blockchain) lagging or going down | Stale prices, missed exits | Health checks, halting when things degrade, fallback providers | You can't act on a price you can't see |
| The network being too congested to get a transaction through | Exits failing exactly when you need them most | Paying higher fees for priority | **Not solvable** |
| Liquidity getting pulled from a pool in a single block | Losing the whole position | Nothing available | **Not solvable** |
| A trade accidentally getting placed twice on retry | Blowing past your own size limit | The safeguards in §11.2 | Low |
| Someone manipulating price to trigger everyone's exit at once | Bad exits across the whole fleet at once | Requiring the move to hold for several slots (§12.2) | Partial |
| The post-mortem loop learning the wrong lesson from too little data | The strategy getting worse instead of better | Repetition thresholds, plus your own review | Unproven whether this actually helps |
| Too many agents competing for the same trades | Worse fills for everyone as the fleet grows | See §14.4 | Gets worse as the fleet grows |
| Someone gaming the public stats | A misleading picture of an agent | Minimum activity requirements (§14.2) | An ongoing, adversarial problem |
| Someone impersonating Noah or an agent | You losing money to a scammer | See §14.6 | Continuous |
| Someone breaking into Noah's own infrastructure | Depends on which custody option is live, see §7 | Per-agent key isolation; the future vault design limits damage to bad trades, not stolen funds | Depends entirely on which custody model is active |

None of this leftover risk is zero, and none of it can be engineered away completely. Only ever deploy money you can afford to lose entirely.

---

## 18. Security and Operations

- Noah never asks for, and never accepts, your seed phrase or private key. Any site or account that does is a scam, not us.
- Noah never messages you first, and never asks you to send a deposit to an address.
- Our one official domain is noahengine.xyz. No other domain is affiliated with us.
- Audit status: ⟦FILL: we'll state this accurately once it's true: "not yet audited, review in progress" is more trustworthy than staying vague⟧.
- Fund a dedicated trading wallet with only the amount you actually intend to trade, not your main wallet.

**Operational promises you can hold us to, and that we intend to measure publicly:** documented behavior for what happens on a restart (§11.4); alerts to you on any outage or automatic halt; a public status page; disclosing incidents within ⟦FILL: a time window not yet set⟧; and published uptime numbers.

---

## 19. How We Make Money, and Who Owns Your Data

We make money from fees, priced in SOL: Paper is free (0 SOL). Going live is designed to cost 0.5 SOL once, per agent you deploy. A "Desk" plan for running multiple agents is custom-priced.

**That fee is a price we've set, not something the platform currently collects.** There is no billing step in the deploy flow today: switching an agent to live trading doesn't require or trigger any payment. Everything in this section describes the intended business model; §16's break-even math is built on this fee as a planning assumption, not as a charge that's actually being taken from anyone right now. This is listed as an open item rather than left implicit (Appendix D).

Once collection exists, we intend to charge that fee once, at deploy time, instead of monthly. As a business, that's actually a weaker way to earn recurring revenue than a subscription, and we're choosing it anyway, because a monthly charge against a small trading balance is a drag you'd pay whether or not your agent was actually doing well (§16.2).

**Noah Engine has launched an official token. The contract address is published on the Deploy page and in the Pricing section. Any other token claiming to be connected to Noah Engine is a scam.**

**A one-time fee is a genuinely weaker way for our interests to line up with yours, and you should read it that way.** A subscription ties our revenue to you continuing to survive and stay a customer. A one-time fee is collected before your agent has even placed a single trade. What's left keeping us honest is reputation, not money: a fleet ranked on survival, with public refusals and public post-mortems, is the actual mechanism, and it has to carry weight that ongoing revenue would otherwise carry for us. You're entitled to treat that as the softer guarantee that it is.

**If you stop an agent, or just walk away from it:** it stops opening new positions immediately. Any positions it already had open keep being watched and exited by their own rules rather than being abandoned, the same behavior as when its circuit breaker trips. The agent's wallet stays yours: you can withdraw its balance to any address, and export its private key, at any time, whether or not you've paid anything else (§7.1). Its memory and post-mortem history are kept for ⟦FILL: how long, not yet decided⟧, and you can **export all of it, at any time, in a format you can actually use.** That record is yours. It's not ours.

---

## 20. Operating Entity

Operating entity: ⟦FILL: legal entity and jurisdiction, not yet decided⟧.

**We're deliberately not naming the people behind Noah Engine here.** Nothing you actually need in order to judge whether to trust this platform depends on who personally wrote the code. What you need is already in this document: the refusals, the post-mortems, the custody model stated without any softening (§7.1), and the limits we've chosen not to hide. Naming a team wouldn't make a held key any safer, and an impressive-sounding team would just tempt you to trust *people* instead of looking at the *evidence*, which is the whole point of publishing this document in the first place.

The legal entity behind the business is a different matter, and it's not optional. A hosted service that holds signing power over your funds and takes your payment needs an identifiable, legal counterparty, because banking and payment processing require it, because regulators require it, and because if this platform ever wrongs you, you're entitled to know exactly who you're dealing with. That's why this field stays marked as unfilled instead of just being deleted.

---

## 21. Roadmap

**Right now: Solana.** The tiered Manifest, constant rechecking of open positions, safe idempotent trade execution, the post-mortem loop, the public refusal feed, and a fleet ranked on survival.

**Next: actually measuring things.** Publishing real statistics on what the Manifest refuses and why, the real gap between paper and live trading, real trading costs, and how fill quality changes as the fleet grows. This is the phase that turns this document from a description of intentions into actual evidence, and it's the single highest-value thing left to do.

**After that: hardening.** Covering more kinds of traps, getting an outside party to review the Manifest, ⟦FILL: a security audit, not yet scheduled⟧, and publishing fill-quality data.

**The custody upgrade: moving from Option D to Option C.** This is the single biggest gap between what this document says it stands for and what's actually running today. Right now, an agent trades from a wallet whose key the platform holds, encrypted, so the most you can lose is what you deposited, but nothing in the code itself stops that balance from being moved elsewhere (§7.1). Option C replaces that held key with a delegate that's only allowed to call specific swap functions and can never send money anywhere except back to the owner's own wallet, turning "we don't take your funds" from a promise into something the code itself enforces. Two smaller steps are worth doing on the way there, before the full vault is built: moving key material behind a narrowly-scoped signing service so a break-in on the main app can't reach it, and keeping a tamper-proof, independent log of every signature request (§7.2).

**Expanding to Base.** The natural second blockchain to support: its launch culture and market structure most resemble Solana's. This needs an entirely new Manifest built from scratch, though: Ethereum-style chains work very differently (upgradeable contracts, blacklist functions, transfer restrictions, fake "renounced ownership" theater), and none of our Solana-specific checks carry over directly.

**Watching, not committing to: Robinhood Chain.** It launched on mainnet July 1, 2026, as a permissionless, fully Ethereum-compatible layer-2 network with very fast blocks. It's built for tokenized real-world assets, not memecoin launches, so we'd only follow if a real speculative market for long-tail tokens actually develops there. This is something we're watching, not something we're committing to.

We're deliberately not putting dates on any of this. A roadmap with dates you end up missing does more damage to your credibility than one that never had dates in the first place.

---

## 22. Disclaimers

Noah Engine is software, provided as-is, with no warranty of any kind. It is not investment advice. It is not portfolio management. It is not a brokerage or any kind of licensed financial service. We make no claim that using it will be profitable, or that it will help you avoid losses.

Trading memecoins is extremely risky, and you can lose all of your capital. How any agent or strategy performed in the past, whether in real trading or simulation, does not tell you how it will perform in the future. Paper trading results are simulated and do not reflect what actually happens in real execution.

Automatic exits are done on a best-effort basis and are not guaranteed. They can fail to execute during an outage, network congestion, liquidity being pulled in a single block, or a price gap (§12.1). Nothing in this system puts a floor under how much you can lose.

The stats shown for the fleet describe what agents have already done. They are not a ranking of investment performance, not a recommendation to use any particular agent or configuration, and not a prediction of future results. An agent being listed in the fleet is not an endorsement of it.

You alone are responsible for complying with the laws that apply to you, including securities law, commodities law, tax law, and money-transmission law. The fact that this service is reachable from where you are does not mean it's legal for you to use it there.

We accept no liability for losses arising from using this software, or from being unable to use it.

**Legal review of this document is still outstanding.** Three things specifically need a lawyer's review before we can call this final: running a hosted service that executes trades for paying users; the custody model described in §7; and publicly displaying trading outcomes, which touches performance-advertising rules in most places. Whoever does that review should look specifically at §7, §14.2, and §14.7.

---

## Appendix A: Default Settings

We keep two separate tables here on purpose. Presenting a target we're aiming for as if it were already built is exactly the kind of dishonesty this appendix exists to avoid.

### A.1 What's Actually Running Today

What a brand-new agent actually runs on, before you change a single setting. Sizes are given in flat SOL amounts, not as a percentage of your balance, because an agent wallet only holds whatever you chose to deposit into it, and that's not necessarily a stand-in for your total net worth (§7.1).

| Parameter | Default | Why |
|---|---|---|
| Which feeds can trigger a trade | Slower, better-informed feed only | The instant feed carries no risk data, and pump.fun strips both key authorities on every launch anyway, so its checks pass for almost the whole platform (§8.1) |
| Minimum pool liquidity | 20 SOL | A thin pool is the easiest thing in this market to drain. If we can't even tell how much liquidity there is, we refuse rather than assume it's fine |
| Max SOL per trade | 0.05 SOL | A flat amount, so depositing more doesn't silently make each trade riskier |
| Max trades open at once | 3 | Limits how much you're exposed to if the whole market dumps at once |
| Max total deployed | 0.15 SOL | Caps your whole book, not just any single trade |
| Fee reserve per trade | 0.01 SOL | A buy should never leave the wallet unable to afford the sale that exits it |
| Exit style | Fixed | A tiered, staged exit is available, but it's off until you turn it on |
| Take profit | +50% | |
| Stop-loss | 20% down | Best-effort, not guaranteed (§12.1) |
| Crash guard | 15% drop in a single check | How sensitive this is depends on your check interval, see A.3 |
| Exit check interval | 4000ms (4 seconds) | Each agent runs its own clock; this isn't shared across the fleet |
| Trailing stop | Off | |
| Breakeven lock | Off | |
| Time-based exit | Off | |
| Max creator initial buy | 10% | |
| Mint authority must be revoked | Required | |
| Freeze authority must be revoked | Required | |
| Must have a social link | Required | |
| Must have a tracked wallet buy in first | Off | Does nothing until you actually add wallets to track |
| Max consecutive losses | 8 | Trips the automatic pause. Set well above 3 on purpose: measured on live paper data at a 22% win rate, a limit of 2 tripped once every 3.1 trades and a limit of 3 once every 6.6, leaving agents paused essentially always. The daily loss limit below is what actually bounds capital harm; this counter only catches a pathological run |
| Daily loss limit | 0.1 SOL | Ends the day's trading before a bad run compounds |
| Cooldown after a loss | 0 seconds | Off by default |
| Trading mode | Paper (simulated) | Going live is a separate, deliberate step (Design Principle 3) |
| Started | No | Deploying an agent sets it up; it doesn't turn it on |

### A.2 What We're Aiming For, But Haven't Built Yet

These are things we intend to build eventually. None of them are exposed in the app today, and unless a row below says otherwise, none of them are actually enforced yet.

| Parameter | Target | Status |
|---|---|---|
| Max top-10 holder concentration | 25% | Actually enforced on the polled feed today, but at a fixed 35%, not the 25% target, and not something you can adjust |
| Max deployer holdings | 5% | Replaced in practice by "max creator initial buy" in A.1 |
| Different size caps per instinct (Raven vs. others) | ⟦FILL⟧ × max | Not built yet (§10) |
| Full Manifest recheck on open positions (sell simulation, tax, authorities) | ⟦FILL⟧ | Not built; only price-based exits recheck today, on the shipped `exitCheckIntervalMs` (Appendix A.1); see §9.5 |
| How many slots an exit needs to be confirmed over | ⟦FILL⟧ | See §12.2 |
| Ready-made presets (Conservative / Balanced / Aggressive) | | Not built; you set every raw number yourself for now |

### A.3 One Setting Affects Another

The crash guard is defined as a drop **within a single check cycle**, which means how sensitive it actually is depends on how often you're checking, not just the percentage you set. The same 15% guard is a much tighter trigger if you check every 3 seconds than if you check every 30. Because of this, every agent is measured against its *own* check interval, not the fastest one in the whole fleet, so nobody else's setting can accidentally change how tight your own stop really is.

## Appendix B: Speed Targets

**None of the numbers in this appendix have actually been measured yet.** This is the speed budget the system was *designed* against. We're keeping it here because the shape of that budget is what drove the whole layered structure in §9, not because we've confirmed these numbers hold up in practice. Treat every figure below as a target, not a measurement.

| Stage | Target time | Network cost |
|---|---|---|
| Receiving and reading a new token from the stream | ⟦FILL⟧ | none |
| Layer 0 checks | under 10ms | none |
| Layer 1 blockchain lookups | 50 to 150ms | ⟦FILL: how many separate requests⟧ |
| Sizing the trade and final go/no-go | under 5ms | none |
| Building the transaction | ⟦FILL⟧ | none |
| Sending it and getting confirmation | ⟦FILL⟧ | ⟦FILL⟧ |
| Layer 2 (runs in parallel, never blocks anything above) | seconds | ⟦FILL⟧ |

## Appendix C: Glossary

**Mint authority**: the power to create new units of a token. If a creator keeps this, they can print unlimited new tokens and wipe out everyone else's share.
**Freeze authority**: the power to freeze someone's token account. If a creator keeps this, they can stop you from selling while they sell.
**LP burn / lock**: "LP" tokens represent ownership of a liquidity pool. If they're burned or locked, the creator can't pull the liquidity you'd need in order to sell.
**Honeypot**: a token designed so you can buy it, but can never sell it.
**Time-delayed honeypot**: a honeypot where selling actually works for a while, then gets switched off.
**Rug pull**: the creator pulls the liquidity out of the pool, crashing the price to near zero.
**Bundled launch**: the creator secretly buys up a large share of the supply across many different wallets in a single block, so it looks like organic demand instead of one person controlling everything.
**Slippage**: the gap between the price you expected and the price you actually got.
**Priority fee**: an extra fee you pay to get your transaction included faster when the network is busy.
**MEV / sandwich attack**: when someone reorders transactions around yours, buying right before you and selling right after, to profit off your trade.
**Token-2022 extensions**: a newer set of Solana token features. Several of them can be used to trap or seize a holder's tokens (see §9.1).
**Idempotency**: the property that doing the same thing twice has the same effect as doing it once, so accidentally retrying an action can't duplicate it.
**Circuit breaker**: an agent's own automatic pause after a losing streak or hitting its daily loss limit. It's recalculated fresh from that agent's actual trade history each time, not stored as a flag that could get stuck.
**RPC**: how software actually reads from and writes to the Solana blockchain: sending a request to a node and getting an answer back.
**AMM (automated market maker)**: a type of exchange with no order book. You trade directly against a pool holding two assets, and the price moves based on the ratio between them.
**Bonding curve**: the pricing formula pump.fun uses for a brand-new token, before it has a real liquidity pool.
**Slot / blockhash**: a "slot" is Solana's basic unit of block time. A "blockhash" is a reference to a recent block, used to prove a transaction is recent and to set a deadline on how long it stays valid.
**KMS / HSM**: specialized hardware, or a dedicated cloud service, built specifically to hold and use cryptographic keys securely, kept separate from the main application so a break-in there doesn't automatically expose the keys.

## Appendix D: What's Still Unfinished

Everything below is a real gap, not a hypothetical one. We're listing it here rather than hiding it.

**Must be resolved before anything is published**

| # | What's missing | Where it matters |
|---|---|---|
| D.1 | Deciding between custody Option B or C, and fixing all site copy to match whichever one is real | §7.1 |
| D.2 | A lawyer's review of custody, paid trade execution, and showing outcomes publicly | §22 |
| D.3 | The key-isolation design fully specified and built | §7.2 |
| D.4 | The legal entity and jurisdiction behind the business (the team itself is deliberately staying unnamed, §20) | §20 |

**Needed before we can make any specific claims**

| # | What's missing | Where it matters |
|---|---|---|
| D.5 | Real Manifest numbers: how many candidates seen, how many refused, and why | §9 |
| D.6 | The latency budget, actually measured instead of just designed | Appendix B |
| D.7 | Real trading costs and break-even math, using measured numbers | §16 |
| D.8 | The real gap between paper and live results, measured | §15 |
| D.9 | Minimum activity thresholds for the fleet stats, decided | §14.2 |
| D.10 | Real data on capacity as the fleet grows | §14.4 |
| D.11 | Building the full Manifest recheck on open positions, and deciding its interval and confirmation slots | §9.5, §12.2 |
| D.12 | What happens if a subscription lapses, and how data export works | §19 |
| D.13 | Audit status, stated accurately | §18 |

**Capabilities described in this document that are not built yet**

Found by checking this document against the running application rather than against itself. Each is a real gap between what's described and what ships, not a wording problem.

| # | What's described | What's actually true today |
|---|---|---|
| D.14 | A repetition threshold before a post-mortem cause becomes a suggested change (§13.1, §13.4) | Not built. Every losing trade is analyzed alone, with no memory of prior trades, so one loss can generate a proposal |
| D.15 | Fleet-wide Manifest rules improving from an operator's accepted lesson (§13.1) | Not built. A proposal can only change your own agent's own exit settings |
| D.16 | Full state recovery on restart: reconstructing entry price from on-chain history, rerunning the Manifest and a fresh sell simulation on recovered positions, and adopting unknown positions found on-chain (§11.4) | Not built. Recovery today checks each position's on-chain balance and closes it if the wallet holds nothing; it does not re-verify a surviving position or adopt one it didn't already know about |
| D.17 | Reserved names, uniqueness checks, and lookalike detection for agent names (§14.6) | Not built. Any name can be used, unchecked |
| D.18 | An opt-in choice for whether a live agent appears on the public fleet page (§14.7) | Not built. Every deployed agent, live or paper, is shown |
| D.19 | The 0.5 SOL live deploy fee actually being collected (§16, §19) | Not built. There is no billing step; going live doesn't require payment today |
| D.20 | Priority fees calculated from network congestion, capped by an operator setting (§11.1) | Not built. Jupiter's own defaults are used |

**Site copy that needs to be corrected to match this document**

| # | What's currently said | What it should say instead |
|---|---|---|
| D.21 | "we only ever see your public address" | Doesn't match §7.1, not true under Option B |
| D.22 | "hard stops, non-negotiable" | Exits are best-effort and rule-based, not guaranteed (§12.1) |
| D.23 | "never makes the same mistake twice" | Losses get analyzed, and causes that recur become suggested changes you review |
| D.24 | "Powered by AI" | State the actual mechanism, and that no AI model is in the trading decision itself (§13.2) |

## Appendix E: Changelog

- **v0.1 through v0.2**: Self-hosted agent framing. Superseded; the product is a hosted platform.
- **v0.3**: Realigned to hosted architecture; custody question raised.
- **v0.4**: Fleet introduced as the organizing frame; survival ranking established.
- **v1.0-rc**: Tiered Manifest with latency budget; shared verdict model; continuous re-verification; idempotency protocol; restart recovery; honest exit semantics; stop-hunt resistance; LLM boundary; fleet eligibility thresholds; economics; threat model; entity and data-ownership sections.
- **v1.1**: Aligned the document with the implementation rather than the design intent. Custody rewritten around the model that actually ships: a generated per-agent wallet funded by deposit, with its key encrypted at rest under an environment-held key, replacing an unresolved choice between two models and a claim of KMS or HSM isolation that does not exist yet (§7). Routing named as Jupiter, with the quote-then-record ordering that prevents a ledger entry for a fill that did not happen (§11.1). The Flood documented as two discovery sources with different latency and different available signals (§8.1). Default configuration split into what ships and what remains target, because publishing the latter as though it were the former was the document's largest inaccuracy (Appendix A). Economics re-denominated from a monthly fiat subscription to a one-time SOL deploy fee, which changes the small-balance conclusion (§16.2). The paper fidelity gap replaced with observations from the first cohort, including an unreachable fill that accounted for its entire apparent profit (§15). Added the agent conversation surface, with two parameter-opacity leaks found while building it: one closed, one disclosed as unresolved (§14.8).
- **v1.2**: Recorded three entry-path changes made after live trading began, each prompted by measured behaviour rather than by design review. Discovery sources became an operator setting defaulting to the polled feed alone, because the push stream's only distinguishing checks are the two authorities pump.fun revokes on every launch, and the first live cohort concentrated its losses there (§8.1, Appendix A.1). The 20 SOL liquidity floor moved from target to shipped default, refusing rather than assuming when liquidity cannot be read; it had sat in A.2 marked "not enforced" while the engine bought into pools holding nothing. Refusals are now written with their reason, which §9.7 describes as public but which the entry paths had been discarding, leaving no way to tell a working filter from a decorative one. Appendix A.2's top-10 concentration row corrected: it is enforced, at a fixed 35% rather than the 25% target.
- **v1.3**: §20 narrowed from "Entity and Team" to the operating entity alone, and its earlier instruction that the section "should not be omitted" replaced with the reasoning for each half separately. The team is now deliberately unnamed: nothing an operator needs in order to evaluate this platform depends on who wrote it, and a named team would invite trust in people to stand in for the evidence this document exists to publish. The legal entity stays marked and outstanding, because a service holding signing authority and taking payment owes its users an identifiable counterparty.
- **v1.4**: The entire document rewritten in plainer language, at a reader's request, so it can be understood without a technical or legal background. Every fact, hedge, number, and open item carries over unchanged, and nothing was softened, added, or quietly dropped in the process. Section numbers and cross-references are unchanged, so existing links to specific sections still work; section titles were simplified for clarity, and a short glossary of Solana-specific terms (RPC, AMM, bonding curve, slot/blockhash, KMS/HSM) was added to Appendix C. Two internal inconsistencies, found only because rewriting required reading every sentence closely, were corrected rather than carried forward: §14.5 referred to "four mechanisms" and later "mechanisms 2 and 4" while only ever listing three, and is now consistent with the three actually described; and §6's threat-model table carried an open ⟦FILL: MEV posture⟧ marker on a row whose answer §11.1 already states plainly, so that marker was replaced with the stated posture and the matching entry (formerly D.11) was removed from Appendix D's open-items list, with the remaining items renumbered.
- **v1.5**: Checked every architectural claim in this document against the application actually running, rather than against the document's own previous drafts, and corrected what didn't match. The pipeline diagram dropped "the Wake" as a parallel entry path; §10 already explained it was removed, but the diagram had never been updated to agree. §8.2's shared-verdict claim was rewritten from a time-based cache with invalidation, which isn't built, to the simpler mechanism that is: one fetch per candidate, shared by every agent evaluating it in that pass. §9.3 now attributes deployer rug history, bundling, and insider concentration to GMGN's own computed fields at fixed thresholds Noah chose, rather than to a funding-graph or bundle-detection system Noah built. §9.5 was the largest correction: only price-based exits (stop-loss, take-profit, trailing, crash guard, time) actually recheck a position after entry; sell simulation, sell tax, LP unlock, and authority changes are not rechecked, which means a time-delayed honeypot is not currently caught after entry despite earlier text implying it was, and every cross-reference to this section elsewhere in the document (§6, §12.2, §17, Appendix A.2, Appendix D) was corrected to match. §11 was rewritten around what actually ships: no persisted intent-ID protocol exists, and no automatic retry exists either; reconciliation happens by reading the agent's real on-chain balance, and an unresolved swap is surfaced rather than guessed at. §11.4's restart recovery was narrowed from six claimed steps to the three that run: orphan detection, an on-chain balance check, and closing a position the wallet no longer holds; reconstructing entry price from transaction history, rerunning the Manifest on recovery, and adopting an unknown on-chain position are now listed as unbuilt (Appendix D). §13.1 no longer claims a repetition threshold or a fleet-wide feedback path from accepted lessons; neither exists, and §13.4 now names a concrete, observed consequence: two accepted-lesson drafts, six minutes apart, told the same agent to hold longer and then to hold less, each generated from a single trade with no memory of the other. §14.6's naming protections and §14.7's live-agent visibility opt-in are now stated as unbuilt rather than as shipped; every deployed agent, live or paper, is currently shown publicly regardless of consent. §16 and §19 now state plainly that the 0.5 SOL live fee is a price that has been set, not one the platform currently collects. Appendix A.1's consecutive-loss default was corrected from 3 to 8, with the measured reasoning the code already carries: at a 22% observed win rate, a limit of 2 tripped every 3.1 trades and a limit of 3 every 6.6, leaving agents paused almost permanently. Appendix D grew a new category, capabilities this document described that are not built, rather than folding these into the existing site-copy or measurement categories, because none of them are a wording problem.
